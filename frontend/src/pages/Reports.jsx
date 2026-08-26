// @ts-nocheck
import React, { useState, useEffect, useMemo } from 'react';
import { DollarSign, ShoppingBag, TrendingUp, Tag, Printer, Download } from 'lucide-react';
import { reportsAPI, settingsAPI } from '@/api/index';
import { buildCsv, money } from '@/lib/csv';
import moment from 'moment';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell, LabelList
} from 'recharts';

const FILTER_CHIPS = [
  { label: 'Today', value: 'today' },
  { label: 'Yesterday', value: 'yesterday' },
  { label: 'Last 7 Days', value: 'last7' },
  { label: 'Last 30 Days', value: 'last30' },
  { label: 'This Month', value: 'thisMonth' },
  { label: 'This Year', value: 'thisYear' },
  { label: 'Custom Range', value: 'custom' },
];

export default function Reports() {
  const [activeFilter, setActiveFilter] = useState('last7');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  
  const [kpi, setKpi] = useState({ revenue: 0, orders: 0, avg_order_value: 0, total_discounts: 0 });
  const [revenueData, setRevenueData] = useState([]);
  const [topItems, setTopItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [heatmapData, setHeatmapData] = useState([]);
  const [cashierPerformance, setCashierPerformance] = useState([]);
  const [detailedReport, setDetailedReport] = useState([]);
  const [lineItems, setLineItems] = useState([]);

  const [reportFormat, setReportFormat] = useState('summary');
  const [restaurantName, setRestaurantName] = useState('Blaze');
  
  // Calculate dates based on filter
  const { from, to } = useMemo(() => {
    if (activeFilter === 'custom') return { from: customFrom, to: customTo };
    const today = moment().format('YYYY-MM-DD');
    switch (activeFilter) {
      case 'today': return { from: today, to: today };
      case 'yesterday': {
        const y = moment().subtract(1, 'days').format('YYYY-MM-DD');
        return { from: y, to: y };
      }
      // The range is inclusive of both ends, so "last 7 days" is today plus the
      // six before it. Subtracting 7 spanned 8 days and disagreed with the same
      // filter on the Orders screen, which uses 6.
      case 'last7': return { from: moment().subtract(6, 'days').format('YYYY-MM-DD'), to: today };
      case 'last30': return { from: moment().subtract(29, 'days').format('YYYY-MM-DD'), to: today };
      case 'thisMonth': return { from: moment().startOf('month').format('YYYY-MM-DD'), to: today };
      case 'thisYear': return { from: moment().startOf('year').format('YYYY-MM-DD'), to: today };
      default: return { from: null, to: null };
    }
  }, [activeFilter, customFrom, customTo]);

  const loadData = async () => {
    try {
      const params = { from, to };
      const [kData, rData, tData, cData, hData, cpData, dData, liData] = await Promise.all([
        reportsAPI.kpi(params),
        reportsAPI.revenueOverTime({ ...params, groupBy: activeFilter === 'today' ? 'hour' : 'day' }),
        reportsAPI.topItems(params),
        reportsAPI.byCategory(params),
        reportsAPI.hourlyHeatmap(params),
        reportsAPI.cashierPerformance(params),
        reportsAPI.detailed(params),
        reportsAPI.lineItems(params)
      ]);
      
      // Transform backend data to match frontend expectations
      setKpi({
        revenue: kData.total_revenue || 0,
        orders: kData.total_orders || 0,
        avg_order_value: kData.avg_order_value || 0,
        total_discounts: kData.total_discounts || 0
      });
      
      setRevenueData(rData.map(d => ({ ...d, date: d.period })));
      
      setTopItems(tData.map(d => ({ ...d, quantity: d.total_qty })));
      
      setCategories(cData);
      
      setHeatmapData(hData);
      
      setCashierPerformance(cpData.map(d => ({
        ...d,
        total_orders: d.total_orders || 0,
        total_revenue: d.total_revenue || 0,
        avg_order_value: d.avg_order_value || 0,
      })));
      
      // The backend now returns a real `subtotal` (summed from the order's own
      // line items) and a real `items` string. `subtotal` used to be aliased to
      // `total` here, which made the Subtotal column report the post-discount
      // figure and left Summary showing identical Revenue and Net Revenue
      // columns either side of a Discounts column that reconciled with neither.
      setDetailedReport(dData);
      setLineItems(liData);
    } catch (err) {
      console.error('Failed to load reports:', err);
    }
  };

  useEffect(() => {
    if (activeFilter !== 'custom' || (customFrom && customTo)) {
      loadData();
    }
  }, [from, to]);

  // Used to name the exported file after the shop rather than a hardcoded string.
  useEffect(() => {
    settingsAPI.getAll()
      .then(s => { if (s.restaurant_name) setRestaurantName(s.restaurant_name); })
      .catch(() => {});
  }, []);

  const PIE_COLORS = ['#DC2626', '#3B82F6', '#10B981', '#8B5CF6', '#F43F5E', '#06B6D4'];

  const printReport = () => {
    window.print();
  };

  /**
   * ── CSV export ────────────────────────────────────────────────────────────
   *
   * Rebuilt so the numbers reconcile and the file survives Excel.
   *
   * `escapeCell` implements RFC 4180 quoting. The previous version stripped
   * commas out of the item list (`replace(/,/g, ';')`), silently corrupting
   * the data to avoid breaking the row, and did nothing at all about a double
   * quote in an item name — one such name shifted every later column.
   *
   * The leading-apostrophe guard defuses CSV injection: a cell beginning with
   * =, +, - or @ is executed as a formula when the file is opened, and item
   * names are operator-editable free text.
   */
  const downloadCsv = (rows, filenameSuffix) => {
    const blob = new Blob([buildCsv(rows)], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = String(restaurantName || 'Blaze').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
    a.download = `${safeName}_${filenameSuffix}_${from}_to_${to}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // The previous version never revoked the object URL, leaking the blob for
    // the lifetime of the window.
    window.URL.revokeObjectURL(url);
  };

  const exportCSV = () => {
    if (reportFormat === 'summary') {
      const byDate = {};
      detailedReport.forEach(row => {
        const date = moment(row.created_at).format('YYYY-MM-DD');
        if (!byDate[date]) {
          byDate[date] = {
            orders: 0, qty: 0, gross: 0, discounts: 0,
            delivery: 0, net: 0, cash: 0, card: 0, online: 0,
          };
        }
        const d = byDate[date];
        d.orders += 1;
        d.qty += Number(row.total_qty) || 0;
        d.gross += Number(row.subtotal) || 0;
        d.discounts += Number(row.discount) || 0;
        d.delivery += Number(row.delivery_charge) || 0;
        d.net += Number(row.total) || 0;
        const method = String(row.payment_method || '').toLowerCase();
        if (method === 'cash') d.cash += Number(row.total) || 0;
        else if (method === 'card') d.card += Number(row.total) || 0;
        else d.online += Number(row.total) || 0;
      });

      const rows = [[
        'Date', 'Orders', 'Items Sold', 'Gross Sales', 'Discounts',
        'Delivery Charges', 'Net Sales', 'Cash', 'Card', 'Online',
      ]];
      const totals = { orders: 0, qty: 0, gross: 0, discounts: 0, delivery: 0, net: 0, cash: 0, card: 0, online: 0 };

      Object.keys(byDate).sort().forEach(date => {
        const d = byDate[date];
        Object.keys(totals).forEach(k => { totals[k] += d[k]; });
        rows.push([
          date, d.orders, d.qty, money(d.gross), money(d.discounts),
          money(d.delivery), money(d.net), money(d.cash), money(d.card), money(d.online),
        ]);
      });

      rows.push([
        'TOTAL', totals.orders, totals.qty, money(totals.gross), money(totals.discounts),
        money(totals.delivery), money(totals.net), money(totals.cash), money(totals.card), money(totals.online),
      ]);

      downloadCsv(rows, 'Sales_Summary');
      return;
    }

    if (reportFormat === 'items') {
      const rows = [[
        'Order #', 'Date', 'Time', 'Cashier', 'Order Type', 'Table/Token',
        'Payment Method', 'Item', 'Category', 'Qty', 'Unit Price', 'Line Total',
      ]];
      let totalQty = 0;
      let totalValue = 0;

      lineItems.forEach(r => {
        totalQty += Number(r.quantity) || 0;
        totalValue += Number(r.line_total) || 0;
        rows.push([
          r.order_id,
          moment(r.created_at).format('YYYY-MM-DD'),
          moment(r.created_at).format('hh:mm A'),
          r.cashier_name || 'Unknown',
          r.order_type || 'Dine-in',
          r.table_number || '',
          r.payment_method || '',
          r.item_name || '',
          r.category || '',
          Number(r.quantity) || 0,
          money(r.unit_price),
          money(r.line_total),
        ]);
      });

      rows.push(['TOTAL', '', '', '', '', '', '', '', '', totalQty, '', money(totalValue)]);
      downloadCsv(rows, 'Item_Sales');
      return;
    }

    // Detailed — one row per order.
    const rows = [[
      'Order #', 'Date', 'Time', 'Cashier', 'Order Type', 'Table/Token',
      'Payment Method', 'Status', 'Items', 'Distinct Items', 'Total Qty',
      'Subtotal', 'Discount', 'Delivery Charge', 'Total',
    ]];
    const totals = { orders: 0, lines: 0, qty: 0, subtotal: 0, discount: 0, delivery: 0, total: 0 };

    detailedReport.forEach(row => {
      totals.orders += 1;
      totals.lines += Number(row.line_count) || 0;
      totals.qty += Number(row.total_qty) || 0;
      totals.subtotal += Number(row.subtotal) || 0;
      totals.discount += Number(row.discount) || 0;
      totals.delivery += Number(row.delivery_charge) || 0;
      totals.total += Number(row.total) || 0;

      rows.push([
        row.id,
        moment(row.created_at).format('YYYY-MM-DD'),
        moment(row.created_at).format('hh:mm A'),
        row.cashier_name || 'Unknown',
        row.order_type || 'Dine-in',
        row.table_number || '',
        row.payment_method || '',
        row.status || '',
        row.items || '',
        Number(row.line_count) || 0,
        Number(row.total_qty) || 0,
        money(row.subtotal),
        money(row.discount),
        money(row.delivery_charge),
        money(row.total),
      ]);
    });

    rows.push([
      'TOTAL', '', '', '', '', '', '', '', '', totals.lines, totals.qty,
      money(totals.subtotal), money(totals.discount), money(totals.delivery), money(totals.total),
    ]);

    downloadCsv(rows, 'Order_Details');
  };

  // Process Heatmap Data
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const hours = Array.from({ length: 15 }, (_, i) => i + 9); // 9AM to 11PM (23:00)
  
  const heatmapGrid = days.map((day, dIdx) => {
    return hours.map(h => {
      const cell = heatmapData.find(hd => Number(hd.day_num) === dIdx && Number(hd.hour) === h);
      return {
        day, hour: h, orders: cell ? cell.orders : 0, revenue: cell ? cell.revenue : 0
      };
    });
  });

  const maxOrders = heatmapData.length > 0 ? Math.max(...heatmapData.map(d => d.orders || 0), 1) : 1;

  const getHeatmapColor = (orders) => {
    if (orders === 0) return '#FFFFFF';
    const intensity = orders / maxOrders;
    if (intensity < 0.2) return '#F2D9A0';
    if (intensity < 0.5) return '#DC2626';
    if (intensity < 0.8) return '#EA580C';
    return '#991B1B';
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-gray-50 overflow-y-auto print:bg-white print:overflow-visible">
      {/* Top Section - Date Filter Bar */}
      <div className="sticky top-0 z-10 flex items-center bg-white border-b border-gray-200 px-5 print:hidden" style={{ minHeight: 52 }}>
        <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap hide-scrollbar">
          {FILTER_CHIPS.map(chip => (
            <button
              key={chip.value}
              onClick={() => setActiveFilter(chip.value)}
              className="px-3 py-1.5 rounded-full text-xs font-medium transition-all"
              style={{
                background: activeFilter === chip.value ? '#B91C1C' : '#FFFFFF',
                color: activeFilter === chip.value ? '#FFFFFF' : '#6B7280',
                border: activeFilter === chip.value ? '1px solid #B91C1C' : '1px solid #D1D5DB',
              }}
            >
              {chip.label}
            </button>
          ))}
          {activeFilter === 'custom' && (
            <div className="flex items-center gap-2 ml-2">
              <input 
                type="date" 
                value={customFrom} 
                onChange={e => setCustomFrom(e.target.value)} 
                className="text-xs px-2 py-1.5 border border-gray-300 rounded focus:outline-none focus:border-orange-500"
              />
              <span className="text-gray-400 text-xs">to</span>
              <input 
                type="date" 
                value={customTo} 
                onChange={e => setCustomTo(e.target.value)} 
                className="text-xs px-2 py-1.5 border border-gray-300 rounded focus:outline-none focus:border-orange-500"
              />
              <button 
                onClick={loadData}
                className="px-3 py-1.5 bg-orange-500 text-white text-xs font-bold rounded hover:bg-orange-600"
              >
                Apply
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="p-6 space-y-6 max-w-7xl mx-auto w-full print:p-0 print:block">
        
        {/* Section 1 - KPI Cards */}
        <div className="grid grid-cols-4 gap-4 print:hidden">
          <KpiCard title="Total Revenue" value={`Rs. ${kpi.revenue.toLocaleString()}`} icon={DollarSign} color="#DC2626" />
          <KpiCard title="Orders Processed" value={kpi.orders} icon={ShoppingBag} color="#3B82F6" />
          <KpiCard title="Avg. Order Value" value={`Rs. ${Math.round(kpi.avg_order_value).toLocaleString()}`} icon={TrendingUp} color="#10B981" />
          <KpiCard title="Discounts Given" value={`Rs. ${kpi.total_discounts.toLocaleString()}`} icon={Tag} color="#EF4444" subtitle={`across ${detailedReport.filter(d => d.discount > 0).length} orders`} />
        </div>

        {/* Section 2 - Revenue Over Time */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm print:hidden">
          <h3 className="text-sm font-bold text-gray-800 mb-4">Revenue Over Time</h3>
          <div style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={revenueData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#6B7280' }} tickMargin={10} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: '#6B7280' }} axisLine={false} tickLine={false} tickFormatter={val => `Rs.${val}`} />
                <RechartsTooltip 
                  contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                  formatter={(value) => [`Rs. ${value}`, 'Revenue']}
                />
                <Line type="monotone" dataKey="revenue" stroke="#DC2626" strokeWidth={3} dot={{ fill: '#FFFFFF', stroke: '#DC2626', strokeWidth: 2, r: 4 }} activeDot={{ r: 6, fill: '#DC2626', stroke: '#FFFFFF' }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Section 3 - Top Items & Categories */}
        <div className="flex gap-6 print:hidden">
          <div className="w-3/5 bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
            <h3 className="text-sm font-bold text-gray-800 mb-4">Top Selling Items</h3>
            <div style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topItems} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E5E7EB" />
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#4B5563' }} width={120} axisLine={false} tickLine={false} />
                  <RechartsTooltip cursor={{ fill: '#F9FAFB' }} contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                  <Bar dataKey="quantity" fill="#DC2626" radius={[0, 4, 4, 0]}>
                    <LabelList dataKey="quantity" position="right" style={{ fontSize: 12, fontWeight: 600, fill: '#111827' }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          
          <div className="w-2/5 bg-white rounded-xl border border-gray-200 p-5 shadow-sm flex flex-col">
            <h3 className="text-sm font-bold text-gray-800 mb-4">Sales by Category</h3>
            <div className="flex-1 flex justify-center items-center relative" style={{ minHeight: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={categories} dataKey="revenue" nameKey="category" cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5}>
                    {categories.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <RechartsTooltip formatter={(value) => `Rs. ${value}`} />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-gray-500 text-xs">Total</span>
                <span className="text-gray-900 font-bold text-sm">Rs. {(categories.reduce((acc, c) => acc + c.revenue, 0)).toLocaleString()}</span>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              {categories.map((c, idx) => (
                <div key={c.category} className="flex justify-between items-center text-xs">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ background: PIE_COLORS[idx % PIE_COLORS.length] }} />
                    <span className="text-gray-600">{c.category}</span>
                  </div>
                  <div className="font-medium text-gray-900">{c.percentage}% <span className="text-gray-400 font-normal ml-1">(Rs.{c.revenue})</span></div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Section 4 - Hourly Heatmap */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm print:hidden">
          <h3 className="text-sm font-bold text-gray-800 mb-4">Busiest Hours of the Day</h3>
          <div className="flex">
            {/* Y Axis - Days */}
            <div className="flex flex-col justify-between mt-6 mr-2">
              {days.map(d => <div key={d} className="text-xs font-medium text-gray-400 h-[36px] flex items-center">{d}</div>)}
            </div>
            {/* Grid */}
            <div className="flex-1">
              <div className="flex mb-2">
                {hours.map(h => <div key={h} className="text-[10px] text-gray-400 w-[36px] text-center flex-1">{h > 12 ? h-12+'p' : h === 12 ? '12p' : h+'a'}</div>)}
              </div>
              <div className="flex flex-col gap-[3px]">
                {heatmapGrid.map((dayRow, i) => (
                  <div key={i} className="flex gap-[3px]">
                    {dayRow.map((cell, j) => (
                      <div 
                        key={j} 
                        className="w-[36px] h-[36px] rounded flex-1 group relative border border-gray-100"
                        style={{ background: getHeatmapColor(cell.orders) }}
                      >
                        {cell.orders > 0 && (
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-20 w-max bg-gray-900 text-white text-xs px-2 py-1 rounded shadow-xl">
                            {cell.day} {cell.hour > 12 ? cell.hour-12+'PM' : cell.hour+'AM'} — {cell.orders} orders — Rs. {cell.revenue}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Section 5 - Cashier Performance */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm print:hidden">
          <h3 className="text-sm font-bold text-gray-800 mb-4">Performance by Cashier</h3>
          {cashierPerformance.length > 0 ? (
            <div className="space-y-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 text-xs uppercase font-semibold border-b border-gray-200">
                    <th className="pb-3">Cashier</th>
                    <th className="pb-3 text-center">Orders</th>
                    <th className="pb-3 text-right">Revenue</th>
                    <th className="pb-3 text-right">Avg Order</th>
                  </tr>
                </thead>
                <tbody>
                  {cashierPerformance.map((cp, idx) => (
                    <tr key={idx} className="border-b border-gray-100 last:border-0">
                      <td className="py-3 font-medium text-gray-900">{cp.cashier_name || 'Unknown'}</td>
                      <td className="py-3 text-center text-gray-600">{cp.total_orders}</td>
                      <td className="py-3 text-right font-semibold text-gray-900">Rs. {cp.total_revenue.toLocaleString()}</td>
                      <td className="py-3 text-right text-gray-600">Rs. {Math.round(cp.avg_order_value).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ height: 200, marginTop: 16 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={cashierPerformance} layout="horizontal" margin={{ left: 100, right: 20, top: 10, bottom: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                    <XAxis type="number" tick={{ fontSize: 11, fill: '#6B7280' }} tickFormatter={val => `Rs.${val}`} />
                    <YAxis type="category" dataKey="cashier_name" tick={{ fontSize: 11, fill: '#4B5563' }} width={90} axisLine={false} tickLine={false} />
                    <RechartsTooltip cursor={{ fill: '#F9FAFB' }} contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} formatter={(value) => [`Rs. ${value}`, 'Revenue']} />
                    <Bar dataKey="total_revenue" fill="#DC2626" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-400 text-sm">No cashier data available for this period</div>
          )}
        </div>

        {/* Section 6 - Sales Report Generator */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm pb-10" id="report-generator">
          <div className="flex justify-between items-center mb-6 print:hidden">
            <h3 className="text-sm font-bold text-gray-800">Generate Sales Report</h3>
            <div className="flex items-center gap-4">
              <div className="flex bg-gray-100 p-1 rounded-lg">
                <button 
                  onClick={() => setReportFormat('summary')} 
                  className={`px-4 py-1.5 text-xs font-semibold rounded-md ${reportFormat === 'summary' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}
                >
                  Summary
                </button>
                <button
                  onClick={() => setReportFormat('detailed')}
                  className={`px-4 py-1.5 text-xs font-semibold rounded-md ${reportFormat === 'detailed' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}
                >
                  Detailed
                </button>
                <button
                  onClick={() => setReportFormat('items')}
                  className={`px-4 py-1.5 text-xs font-semibold rounded-md ${reportFormat === 'items' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}
                >
                  Item Sales
                </button>
              </div>
            </div>
          </div>

          <div id="printable-area" className="w-full">
            <div className="hidden print:block mb-6 text-center">
              <h2 className="text-xl font-bold">Sales Report</h2>
              <p className="text-sm text-gray-500">{from} to {to}</p>
            </div>
            
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-500 uppercase text-[11px] font-bold border-b border-gray-200">
                  {reportFormat === 'summary' ? (
                    <>
                      <th className="py-3 px-4">Date</th>
                      <th className="py-3 px-4 text-center">Total Orders</th>
                      <th className="py-3 px-4 text-right">Gross Sales</th>
                      <th className="py-3 px-4 text-right">Discounts</th>
                      <th className="py-3 px-4 text-right text-orange-600">Net Revenue</th>
                    </>
                  ) : reportFormat === 'items' ? (
                    <>
                      <th className="py-3 px-4">Order #</th>
                      <th className="py-3 px-4">Time</th>
                      <th className="py-3 px-4">Item</th>
                      <th className="py-3 px-4">Category</th>
                      <th className="py-3 px-4 text-center">Qty</th>
                      <th className="py-3 px-4 text-right">Unit Price</th>
                      <th className="py-3 px-4 text-right text-orange-600">Line Total</th>
                    </>
                  ) : (
                    <>
                      <th className="py-3 px-4">Order #</th>
                      <th className="py-3 px-4">Time</th>
                      <th className="py-3 px-4">Items</th>
                      <th className="py-3 px-4 text-center">Payment</th>
                      <th className="py-3 px-4 text-right">Subtotal</th>
                      <th className="py-3 px-4 text-right">Discount</th>
                      <th className="py-3 px-4 text-right text-orange-600">Total</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {reportFormat === 'summary' ? (
                  // Group by date
                  Object.entries(
                    detailedReport.reduce((acc, row) => {
                      const date = moment(row.created_at).format('YYYY-MM-DD');
                      if (!acc[date]) acc[date] = { date, orders: 0, revenue: 0, discounts: 0, net: 0 };
                      acc[date].orders += 1;
                      // Gross (pre-discount) vs net (what was actually taken).
                      // These were both summing `total`, so the two money
                      // columns always matched and the discount column between
                      // them reconciled with neither.
                      acc[date].revenue += Number(row.subtotal) || 0;
                      acc[date].discounts += Number(row.discount) || 0;
                      acc[date].net += Number(row.total) || 0;
                      return acc;
                    }, {})
                  ).sort((a,b) => a[0].localeCompare(b[0])).map(([date, d], i) => (
                    <tr key={date} className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
                      <td className="py-3 px-4 font-medium text-gray-900">{moment(date).format('MMM D, YYYY')}</td>
                      <td className="py-3 px-4 text-center text-gray-600">{d.orders}</td>
                      <td className="py-3 px-4 text-right text-gray-600">Rs. {d.revenue.toLocaleString()}</td>
                      <td className="py-3 px-4 text-right text-red-500">-Rs. {d.discounts.toLocaleString()}</td>
                      <td className="py-3 px-4 text-right font-bold text-gray-900">Rs. {d.net.toLocaleString()}</td>
                    </tr>
                  ))
                ) : reportFormat === 'items' ? (
                  // Item Sales view — one row per item sold.
                  lineItems.map((row, i) => (
                    <tr key={`${row.order_id}-${i}`} className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
                      <td className="py-3 px-4 font-medium text-gray-900">#{row.order_id}</td>
                      <td className="py-3 px-4 text-gray-500 text-xs">{moment(row.created_at).format('MMM D, hh:mm A')}</td>
                      <td className="py-3 px-4 text-gray-700 text-xs">{row.item_name}</td>
                      <td className="py-3 px-4 text-gray-500 text-xs">{row.category}</td>
                      <td className="py-3 px-4 text-center text-gray-600">{row.quantity}</td>
                      <td className="py-3 px-4 text-right text-gray-600">Rs. {Number(row.unit_price).toLocaleString()}</td>
                      <td className="py-3 px-4 text-right font-bold text-gray-900">Rs. {Number(row.line_total).toLocaleString()}</td>
                    </tr>
                  ))
                ) : (
                  // Detailed view
                  detailedReport.map((row, i) => (
                    <tr key={row.id} className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
                      <td className="py-3 px-4 font-medium text-gray-900">#{row.id}</td>
                      <td className="py-3 px-4 text-gray-500 text-xs">{moment(row.created_at).format('MMM D, hh:mm A')}</td>
                      <td className="py-3 px-4 text-gray-600 text-xs truncate max-w-[200px]" title={row.items}>{row.items}</td>
                      <td className="py-3 px-4 text-center">
                        <span className={`px-2 py-1 rounded text-[10px] font-bold ${row.payment_method === 'Cash' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                          {row.payment_method}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right text-gray-600">Rs. {Number(row.subtotal || 0).toLocaleString()}</td>
                      <td className="py-3 px-4 text-right text-red-500">{row.discount > 0 ? `-Rs. ${row.discount}` : '—'}</td>
                      <td className="py-3 px-4 text-right font-bold text-gray-900">Rs. {Number(row.total || 0).toLocaleString()}</td>
                    </tr>
                  ))
                )}
                {(reportFormat === 'items' ? lineItems.length : detailedReport.length) === 0 && (
                  <tr>
                    <td colSpan={reportFormat === 'summary' ? 5 : 7} className="py-8 text-center text-gray-400">
                      No orders found for this date range.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex gap-4 mt-6 print:hidden">
            <button
              onClick={printReport}
              className="flex items-center gap-2 px-6 py-2.5 bg-gray-900 text-white rounded-lg text-sm font-bold hover:bg-gray-800 transition-colors"
            >
              <Printer size={16} /> Print Report
            </button>
            <button
              onClick={exportCSV}
              className="flex items-center gap-2 px-6 py-2.5 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-bold hover:bg-gray-50 transition-colors"
            >
              <Download size={16} /> Export CSV
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}

function KpiCard({ title, value, icon: Icon, color, subtitle }) {
  return (
    <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex items-center gap-4">
      <div className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: `${color}15` }}>
        <Icon size={24} color={color} />
      </div>
      <div>
        <div className="text-gray-500 text-xs font-semibold uppercase tracking-wider mb-1">{title}</div>
        <div className="text-2xl font-bold text-gray-900">{value}</div>
        {subtitle && <div className="text-xs text-gray-400 mt-0.5">{subtitle}</div>}
      </div>
    </div>
  );
}
// @ts-nocheck
import React, { useState, useEffect, useMemo } from 'react';
import { DollarSign, ShoppingBag, TrendingUp, Tag, Printer, Download, FileSpreadsheet, Wallet } from 'lucide-react';
import { reportsAPI, branchesAPI } from '@/api/index';
import { buildCsv, money } from '@/lib/csv';
import { useSettings } from '@/lib/SettingsContext';
import { useAuth } from '@/context/AuthContext';
import writeXlsxFile from 'write-excel-file/browser';
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
  
  const [kpi, setKpi] = useState({ revenue: 0, orders: 0, avg_order_value: 0, total_discounts: 0, total_expenses: 0, drawer_expenses: 0, expense_count: 0, net_revenue: 0 });
  const [revenueData, setRevenueData] = useState([]);
  const [topItems, setTopItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [heatmapData, setHeatmapData] = useState([]);
  const [cashierPerformance, setCashierPerformance] = useState([]);
  const [detailedReport, setDetailedReport] = useState([]);
  const [lineItems, setLineItems] = useState([]);
  const [expenseCategories, setExpenseCategories] = useState([]);
  const [expenseDetail, setExpenseDetail] = useState([]);

  /*
   * Branch filter — administrators only.
   *
   * A manager is already restricted to their own sales, so a branch picker
   * would only ever return their own figures or an empty report; the backend
   * ignores the parameter for them and the control is hidden here.
   */
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState('');
  /** Names of report sections whose request failed, shown in a banner. */
  const [loadErrors, setLoadErrors] = useState([]);

  const [reportFormat, setReportFormat] = useState('summary');
  // Shop name (used to name the exported file) and money formatting both
  // come from the shared settings provider rather than a second fetch.
  const { formatMoney, restaurant } = useSettings();
  // A manager may read the day's figures but not take a copy out of the
  // building. Viewing needs the data, so this is a UI control rather than a
  // hard boundary — the settings and menu routes are the enforced ones.
  const { isAdmin } = useAuth();
  const restaurantName = restaurant.name || 'Blaze';
  
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

  useEffect(() => {
    if (!isAdmin) return;
    branchesAPI.getAll()
      .then(rows => setBranches(Array.isArray(rows) ? rows : []))
      // Without the list the picker simply does not appear; the report still
      // loads, covering every branch.
      .catch(() => setBranches([]));
  }, [isAdmin]);

  const loadData = async () => {
    try {
      // `branch` is only ever sent by an administrator, and an empty value
      // means "all branches" rather than "no branch".
      const params = branchId ? { from, to, branch: branchId } : { from, to };

      /*
       * `allSettled`, not `all`.
       *
       * These ten requests fill ten independent panels, but `Promise.all`
       * rejects the moment any one of them does — so a single failing endpoint
       * left the entire Reports screen blank, KPIs and charts included, with
       * nothing on screen to say why. One broken panel should cost one panel.
       *
       * Each result falls back to an empty value of the right shape, and the
       * failures are logged and surfaced in a banner rather than swallowed.
       */
      const settled = await Promise.allSettled([
        reportsAPI.kpi(params),
        reportsAPI.revenueOverTime({ ...params, groupBy: activeFilter === 'today' ? 'hour' : 'day' }),
        reportsAPI.topItems(params),
        reportsAPI.byCategory(params),
        reportsAPI.hourlyHeatmap(params),
        reportsAPI.cashierPerformance(params),
        reportsAPI.detailed(params),
        reportsAPI.lineItems(params),
        reportsAPI.expensesByCategory(params),
        reportsAPI.expensesDetail(params)
      ]);

      const NAMES = ['Summary', 'Revenue over time', 'Top items', 'Sales by category',
        'Busiest hours', 'Staff performance', 'Order details', 'Item sales',
        'Expenses by category', 'Expense details'];

      const failed = [];
      settled.forEach((r, i) => {
        if (r.status === 'rejected') {
          failed.push(NAMES[i]);
          console.error(`Report section "${NAMES[i]}" failed to load:`, r.reason);
        }
      });
      setLoadErrors(failed);

      const val = (i, fallback) => {
        if (settled[i].status !== 'fulfilled' || settled[i].value == null) return fallback;
        // An endpoint that answered with something other than the expected
        // shape must not take the panel down either — several of these are
        // mapped over immediately below.
        if (Array.isArray(fallback) && !Array.isArray(settled[i].value)) return fallback;
        return settled[i].value;
      };

      const kData   = val(0, {});
      const rData   = val(1, []);
      const tData   = val(2, []);
      const cData   = val(3, []);
      const hData   = val(4, []);
      const cpData  = val(5, []);
      const dData   = val(6, []);
      const liData  = val(7, []);
      const exCat   = val(8, []);
      const exDetail = val(9, []);
      
      // Transform backend data to match frontend expectations
      setKpi({
        revenue: kData.total_revenue || 0,
        orders: kData.total_orders || 0,
        avg_order_value: kData.avg_order_value || 0,
        total_discounts: kData.total_discounts || 0,
        // What went out, and what is actually left after it.
        total_expenses: kData.total_expenses || 0,
        drawer_expenses: kData.drawer_expenses || 0,
        expense_count: kData.expense_count || 0,
        net_revenue: kData.net_revenue ?? ((kData.total_revenue || 0) - (kData.total_expenses || 0)),
      });

      setExpenseCategories(Array.isArray(exCat) ? exCat : []);
      setExpenseDetail(Array.isArray(exDetail) ? exDetail : []);
      
      setRevenueData(rData.map(d => ({ ...d, date: d.period })));
      
      setTopItems(tData.map(d => ({ ...d, quantity: d.total_qty })));
      
      // FIX: "Sales by Category" always rendered zero. /reports/by-category
      // returns `total_revenue` and `total_qty`, but the pie's dataKey, the
      // centre total and every legend row all read `revenue` — which does not
      // exist on these rows, so each one formatted `undefined` as 0. Normalise
      // the shape here, the same way top items already are.
      setCategories(cData.map(d => ({
        ...d,
        revenue: Number(d.total_revenue) || 0,
        quantity: Number(d.total_qty) || 0,
      })));
      
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
    // Switching branch re-runs every query, so the whole page — charts,
    // tables and the export — always describes one branch at a time.
  }, [from, to, branchId]);


  const PIE_COLORS = ['#DC2626', '#3B82F6', '#10B981', '#8B5CF6', '#F43F5E', '#06B6D4'];

  const printReport = () => {
    window.print();
  };

  /**
   * Build a Date that Excel will render as the intended calendar day.
   *
   * write-excel-file serialises a Date from its **UTC** components. A local
   * midnight here is 19:00 the previous day in UTC, so passing
   * `moment(x).startOf('day').toDate()` wrote every date one day early —
   * an order rung up on the 17th exported as the 16th. Pinning the value to
   * UTC midnight of the same calendar date makes the serial a whole number and
   * the rendered date correct regardless of the machine's timezone.
   */
  const excelDate = (value) => {
    const m = moment(value);
    return new Date(Date.UTC(m.year(), m.month(), m.date()));
  };

  const exportFileName = (suffix, ext) => {
    const safeName = String(restaurantName || 'Blaze').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
    return `${safeName}_${suffix}_${from}_to_${to}.${ext}`;
  };

  /**
   * ── Report definition ─────────────────────────────────────────────────────
   *
   * A report is described once — its columns and its records — and both the
   * CSV and the Excel export render from that single definition, so the two
   * can never drift apart in columns, ordering or arithmetic.
   *
   * `width` is in characters and only means anything to the Excel export.
   * A CSV carries no formatting at all, which is why a date column there shows
   * as ###### until the reader widens it: Excel parses the value as a date,
   * and a date is too wide for the default column. The xlsx export sets real
   * widths, so it opens readable.
   */
  const getReportTable = () => {
    if (reportFormat === 'summary') {
      const byDate = {};
      detailedReport.forEach(row => {
        const date = moment(row.created_at).format('YYYY-MM-DD');
        if (!byDate[date]) {
          byDate[date] = {
            orders: 0, qty: 0, gross: 0, discounts: 0,
            delivery: 0, net: 0, cash: 0, card: 0, online: 0,
            staffOrders: 0, staffDiscount: 0,
          };
        }
        const d = byDate[date];
        d.orders += 1;
        d.qty += Number(row.total_qty) || 0;
        d.gross += Number(row.subtotal) || 0;
        d.discounts += Number(row.discount) || 0;
        d.delivery += Number(row.delivery_charge) || 0;
        d.net += Number(row.total) || 0;
        if (row.is_employee) d.staffOrders += 1;
        d.staffDiscount += Number(row.employee_discount) || 0;
        const method = String(row.payment_method || '').toLowerCase();
        if (method === 'cash') d.cash += Number(row.total) || 0;
        else if (method === 'card') d.card += Number(row.total) || 0;
        else d.online += Number(row.total) || 0;
      });

      /*
       * Fold the day's payouts in alongside its takings.
       *
       * Keyed off the expense's own date rather than the order list, so a day
       * the shop was shut but still paid a supplier gets its own row instead
       * of being dropped — which would quietly overstate the period's net.
       */
      expenseDetail.forEach(e => {
        const date = moment(e.created_at).format('YYYY-MM-DD');
        if (!byDate[date]) {
          byDate[date] = {
            orders: 0, qty: 0, gross: 0, discounts: 0,
            delivery: 0, net: 0, cash: 0, card: 0, online: 0,
            staffOrders: 0, staffDiscount: 0, expenses: 0, drawerExpenses: 0,
          };
        }
        const d = byDate[date];
        d.expenses = (d.expenses || 0) + (Number(e.amount) || 0);
        if (e.from_drawer) d.drawerExpenses = (d.drawerExpenses || 0) + (Number(e.amount) || 0);
      });

      const records = Object.keys(byDate).sort().map(date => {
        const d = byDate[date];
        const expenses = d.expenses || 0;
        return {
          date,
          ...d,
          expenses,
          drawerExpenses: d.drawerExpenses || 0,
          // What the day actually left behind, which is the figure the owner
          // is looking for and the one the KPI row leads with.
          netRevenue: (d.net || 0) - expenses,
        };
      });

      const t = { orders: 0, qty: 0, gross: 0, discounts: 0, delivery: 0, net: 0, cash: 0, card: 0, online: 0, staffOrders: 0, staffDiscount: 0, expenses: 0, drawerExpenses: 0, netRevenue: 0 };
      records.forEach(r => Object.keys(t).forEach(k => { t[k] += (r[k] || 0); }));

      return {
        name: 'Sales_Summary',
        records,
        columns: [
          { header: 'Date',             width: 13, type: 'date',  value: r => excelDate(moment(r.date, 'YYYY-MM-DD')), total: () => 'TOTAL' },
          { header: 'Orders',           width: 9,  type: 'int',   value: r => r.orders,          total: () => t.orders },
          { header: 'Items Sold',       width: 11, type: 'int',   value: r => r.qty,             total: () => t.qty },
          { header: 'Gross Sales',      width: 13, type: 'money', value: r => money(r.gross),    total: () => money(t.gross) },
          { header: 'Discounts',        width: 12, type: 'money', value: r => money(r.discounts),total: () => money(t.discounts) },
          { header: 'Delivery Charges', width: 16, type: 'money', value: r => money(r.delivery), total: () => money(t.delivery) },
          { header: 'Net Sales',        width: 13, type: 'money', value: r => money(r.net),      total: () => money(t.net) },
          { header: 'Cash',             width: 12, type: 'money', value: r => money(r.cash),     total: () => money(t.cash) },
          { header: 'Card',             width: 12, type: 'money', value: r => money(r.card),     total: () => money(t.card) },
          { header: 'Online',           width: 12, type: 'money', value: r => money(r.online),   total: () => money(t.online) },
          { header: 'Staff Orders',     width: 13, type: 'int',   value: r => r.staffOrders,     total: () => t.staffOrders },
          { header: 'Staff Discount',   width: 14, type: 'money', value: r => money(r.staffDiscount), total: () => money(t.staffDiscount) },
          { header: 'Expenses',         width: 12, type: 'money', value: r => money(r.expenses),      total: () => money(t.expenses) },
          { header: 'Paid From Drawer', width: 17, type: 'money', value: r => money(r.drawerExpenses), total: () => money(t.drawerExpenses) },
          { header: 'Net Revenue',      width: 13, type: 'money', value: r => money(r.netRevenue),    total: () => money(t.netRevenue) },
        ],
      };
    }

    /*
     * Expenses — one row per payout.
     *
     * Its own format rather than a column on another report: an expense has no
     * order, no items and no payment method, so forcing it into the sales
     * tables would leave most of every row blank.
     */
    if (reportFormat === 'expenses') {
      const t = { amount: 0, drawer: 0 };
      expenseDetail.forEach(r => {
        t.amount += Number(r.amount) || 0;
        if (r.from_drawer) t.drawer += Number(r.amount) || 0;
      });

      return {
        name: 'Expenses',
        records: expenseDetail,
        columns: [
          { header: 'Date',           width: 13, type: 'date',  value: r => excelDate(r.created_at), total: () => 'TOTAL' },
          { header: 'Time',           width: 11, type: 'text',  value: r => moment(r.created_at).format('hh:mm A') },
          { header: 'Branch',         width: 18, type: 'text',  value: r => r.branch_name || 'Unassigned' },
          { header: 'Category',       width: 20, type: 'text',  value: r => r.category || '' },
          { header: 'Description',    width: 40, type: 'text',  value: r => r.description || '' },
          { header: 'Recorded By',    width: 18, type: 'text',  value: r => r.staff_name || 'Unknown' },
          { header: 'From Drawer',    width: 13, type: 'text',  value: r => (r.from_drawer ? 'Yes' : 'No') },
          { header: 'Shift #',        width: 9,  type: 'text',  value: r => (r.shift_id == null ? '' : r.shift_id) },
          { header: 'Amount',         width: 13, type: 'money', value: r => money(r.amount), total: () => money(t.amount) },
        ],
      };
    }

    if (reportFormat === 'items') {
      const t = { qty: 0, value: 0 };
      lineItems.forEach(r => {
        t.qty += Number(r.quantity) || 0;
        t.value += Number(r.line_total) || 0;
      });

      return {
        name: 'Item_Sales',
        records: lineItems,
        columns: [
          { header: 'Order #',        width: 9,  type: 'int',   value: r => r.order_id, total: () => 'TOTAL' },
          { header: 'Date',           width: 13, type: 'date',  value: r => excelDate(r.created_at) },
          { header: 'Time',           width: 11, type: 'text',  value: r => moment(r.created_at).format('hh:mm A') },
          { header: 'Branch',         width: 18, type: 'text',  value: r => r.branch_name || 'Unassigned' },
          { header: 'Cashier',        width: 16, type: 'text',  value: r => r.cashier_name || 'Unknown' },
          { header: 'Order Type',     width: 13, type: 'text',  value: r => r.order_type || 'Dine-in' },
          { header: 'Table/Token',    width: 13, type: 'text',  value: r => r.table_number || '' },
          { header: 'Payment Method', width: 16, type: 'text',  value: r => r.payment_method || '' },
          { header: 'Item',           width: 34, type: 'text',  value: r => r.item_name || '' },
          { header: 'Category',       width: 18, type: 'text',  value: r => r.category || '' },
          { header: 'Qty',            width: 8,  type: 'int',   value: r => Number(r.quantity) || 0, total: () => t.qty },
          { header: 'Unit Price',     width: 12, type: 'money', value: r => money(r.unit_price) },
          { header: 'Line Total',     width: 13, type: 'money', value: r => money(r.line_total), total: () => money(t.value) },
        ],
      };
    }

    // Detailed — one row per order.
    const t = { lines: 0, qty: 0, subtotal: 0, discount: 0, delivery: 0, total: 0, employeeDiscount: 0 };
    detailedReport.forEach(r => {
      t.employeeDiscount += Number(r.employee_discount) || 0;
      t.lines += Number(r.line_count) || 0;
      t.qty += Number(r.total_qty) || 0;
      t.subtotal += Number(r.subtotal) || 0;
      t.discount += Number(r.discount) || 0;
      t.delivery += Number(r.delivery_charge) || 0;
      t.total += Number(r.total) || 0;
    });

    return {
      name: 'Order_Details',
      records: detailedReport,
      columns: [
        { header: 'Order #',         width: 9,  type: 'int',   value: r => r.id, total: () => 'TOTAL' },
        { header: 'Date',            width: 13, type: 'date',  value: r => excelDate(r.created_at) },
        { header: 'Time',            width: 11, type: 'text',  value: r => moment(r.created_at).format('hh:mm A') },
        { header: 'Branch',          width: 18, type: 'text',  value: r => r.branch_name || 'Unassigned' },
        { header: 'Cashier',         width: 16, type: 'text',  value: r => r.cashier_name || 'Unknown' },
        { header: 'Order Type',      width: 13, type: 'text',  value: r => r.order_type || 'Dine-in' },
        { header: 'Table/Token',     width: 13, type: 'text',  value: r => r.table_number || '' },
        { header: 'Payment Method',  width: 16, type: 'text',  value: r => r.payment_method || '' },
        { header: 'Status',          width: 12, type: 'text',  value: r => r.status || '' },
        { header: 'Staff Purchase',  width: 14, type: 'text',  value: r => (r.is_employee ? 'Yes' : 'No') },
        { header: 'Staff Discount',  width: 14, type: 'money', value: r => money(r.employee_discount), total: () => money(t.employeeDiscount) },
        // Who the delivery went to. Blank on a dine-in order, and blank on a
        // delivery where the cashier skipped the prompt.
        { header: 'Customer',        width: 20, type: 'text',  value: r => r.customer_name || '' },
        { header: 'Customer Phone',  width: 16, type: 'text',  value: r => r.customer_phone || '' },
        { header: 'Customer Address',width: 34, type: 'text',  value: r => r.customer_address || '' },
        { header: 'Items',           width: 52, type: 'text',  value: r => r.items || '' },
        { header: 'Distinct Items',  width: 14, type: 'int',   value: r => Number(r.line_count) || 0, total: () => t.lines },
        { header: 'Total Qty',       width: 11, type: 'int',   value: r => Number(r.total_qty) || 0,  total: () => t.qty },
        { header: 'Subtotal',        width: 12, type: 'money', value: r => money(r.subtotal),         total: () => money(t.subtotal) },
        { header: 'Discount',        width: 12, type: 'money', value: r => money(r.discount),         total: () => money(t.discount) },
        { header: 'Delivery Charge', width: 16, type: 'money', value: r => money(r.delivery_charge),  total: () => money(t.delivery) },
        { header: 'Total',           width: 13, type: 'money', value: r => money(r.total),            total: () => money(t.total) },
      ],
    };
  };

  /** Render one schema cell for CSV, where everything is ultimately text. */
  const csvCell = (col, record) => {
    const v = col.value(record);
    if (v instanceof Date) return moment(v).format('YYYY-MM-DD');
    return v;
  };

  const exportCSV = () => {
    const table = getReportTable();
    const rows = [table.columns.map(c => c.header)];

    table.records.forEach(record => {
      rows.push(table.columns.map(col => csvCell(col, record)));
    });

    // A column with no `total` contributes a blank cell to the totals row.
    rows.push(table.columns.map(col => (col.total ? col.total() : '')));

    const blob = new Blob([buildCsv(rows)], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = exportFileName(table.name, 'csv');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // The previous version never revoked the object URL, leaking the blob for
    // the lifetime of the window.
    window.URL.revokeObjectURL(url);
  };

  /**
   * Excel export.
   *
   * Unlike CSV this carries real column widths, so the date column is readable
   * the moment the file opens rather than rendering as ######, and dates and
   * money are written as genuine Excel types so they sort, filter and SUM
   * without the reader having to convert anything first.
   */
  const exportExcel = async () => {
    const table = getReportTable();

    const headerStyle = {
      value: null, fontWeight: 'bold', backgroundColor: '#F3F4F6',
      align: 'left', borderColor: '#D1D5DB', bottomBorderStyle: 'thin',
    };

    const cellFor = (col, value, bold) => {
      const base = bold ? { fontWeight: 'bold' } : {};
      if (value === null || value === undefined || value === '') {
        return { ...base, value: null, type: String };
      }
      if (value instanceof Date) {
        return { ...base, value, type: Date, format: 'yyyy-mm-dd', align: 'left' };
      }
      if (col.type === 'money') {
        return { ...base, value: Number(value), type: Number, format: '#,##0.00', align: 'right' };
      }
      if (col.type === 'int') {
        // The totals row puts the label "TOTAL" under an integer column.
        if (typeof value === 'string') return { ...base, value, type: String };
        return { ...base, value: Number(value), type: Number, format: '#,##0', align: 'right' };
      }
      return { ...base, value: String(value), type: String };
    };

    const data = [table.columns.map(c => ({ ...headerStyle, value: c.header, type: String }))];

    table.records.forEach(record => {
      data.push(table.columns.map(col => cellFor(col, col.value(record), false)));
    });

    data.push(table.columns.map(col => cellFor(col, col.total ? col.total() : null, true)));

    // write-excel-file v4 returns a writer rather than taking a fileName
    // option; `.toFile()` is what actually triggers the download.
    await writeXlsxFile(data, {
      columns: table.columns.map(c => ({ width: c.width })),
      sheet: 'Report',
      // Keep the header visible when scrolling a long report.
      stickyRowsCount: 1,
    }).toFile(exportFileName(table.name, 'xlsx'));
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
          {/*
            Which branch these figures describe. Sits ahead of the date chips
            because it changes what the whole page is about, not just its
            window — everything below, including the export, follows it.
          */}
          {isAdmin && branches.length > 0 && (
            <>
              <select
                value={branchId}
                onChange={e => setBranchId(e.target.value)}
                className="text-xs font-semibold px-3 py-1.5 rounded-full border cursor-pointer focus:outline-none"
                style={{
                  background: branchId ? '#B91C1C' : '#FFFFFF',
                  color: branchId ? '#FFFFFF' : '#374151',
                  borderColor: branchId ? '#B91C1C' : '#D1D5DB',
                }}
              >
                <option value="">All Branches</option>
                {branches.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
              <div className="h-5 w-px bg-gray-300 mx-1" />
            </>
          )}
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
        
        {/*
          Say so when a panel could not load, rather than showing an empty
          chart that reads as "no sales". The rest of the page still renders.
        */}
        {loadErrors.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 print:hidden">
            <span className="font-semibold">Some sections could not be loaded:</span>{' '}
            {loadErrors.join(', ')}. The figures shown exclude them.
          </div>
        )}

        {/* Section 1 - KPI Cards */}
        <div className="grid grid-cols-4 gap-4 print:hidden">
          <KpiCard title="Total Revenue" value={formatMoney(kpi.revenue)} icon={DollarSign} color="#DC2626" />
          <KpiCard title="Orders Processed" value={kpi.orders} icon={ShoppingBag} color="#3B82F6" />
          <KpiCard title="Avg. Order Value" value={formatMoney(kpi.avg_order_value)} icon={TrendingUp} color="#10B981" />
          <KpiCard title="Discounts Given" value={formatMoney(kpi.total_discounts)} icon={Tag} color="#EF4444" subtitle={`across ${detailedReport.filter(d => d.discount > 0).length} orders`} />
        </div>

        {/*
          Takings alone flatter the day. A shop can ring up 40,000 and still be
          down if 9,000 went out on fuel and supplies, so what was spent and
          what is actually left get their own row directly beneath.
        */}
        <div className="grid grid-cols-2 gap-4 print:hidden">
          <KpiCard
            title="Expenses"
            value={formatMoney(kpi.total_expenses)}
            icon={Wallet}
            color="#F59E0B"
            subtitle={`${kpi.expense_count} ${kpi.expense_count === 1 ? 'entry' : 'entries'}${kpi.drawer_expenses ? ` · ${formatMoney(kpi.drawer_expenses)} from the drawer` : ''}`}
          />
          <KpiCard
            title="Net Revenue"
            value={formatMoney(kpi.net_revenue)}
            icon={TrendingUp}
            color={kpi.net_revenue < 0 ? '#DC2626' : '#059669'}
            subtitle="Revenue less expenses"
          />
        </div>

        {/* Section 2 - Revenue Over Time */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm print:hidden">
          <h3 className="text-sm font-bold text-gray-800 mb-4">Revenue Over Time</h3>
          <div style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={revenueData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#6B7280' }} tickMargin={10} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: '#6B7280' }} axisLine={false} tickLine={false} tickFormatter={val => formatMoney(val)} />
                <RechartsTooltip 
                  contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                  formatter={(value) => [formatMoney(value), 'Revenue']}
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
                  <RechartsTooltip formatter={(value) => formatMoney(value)} />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-gray-500 text-xs">Total</span>
                <span className="text-gray-900 font-bold text-sm">{formatMoney(categories.reduce((acc, c) => acc + c.revenue, 0))}</span>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              {categories.map((c, idx) => (
                <div key={c.category} className="flex justify-between items-center text-xs">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ background: PIE_COLORS[idx % PIE_COLORS.length] }} />
                    <span className="text-gray-600">{c.category}</span>
                  </div>
                  <div className="font-medium text-gray-900">{c.percentage}% <span className="text-gray-400 font-normal ml-1">({formatMoney(c.revenue)})</span></div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/*
          Where the Money Went — the mirror of Sales by Category above.
          Together the two answer the whole question: what came in, and what
          went out. Only rendered when there is something to show, so a day
          with no payouts is not padded with an empty panel.
        */}
        {expenseDetail.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm print:hidden">
            <div className="flex items-baseline justify-between mb-4">
              <h3 className="text-sm font-bold text-gray-800">Where the Money Went</h3>
              <span className="text-xs text-gray-500">
                {formatMoney(kpi.total_expenses)} across {expenseDetail.length}{' '}
                {expenseDetail.length === 1 ? 'entry' : 'entries'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">By category</p>
                <div className="space-y-2">
                  {expenseCategories.map(c => {
                    const share = kpi.total_expenses > 0
                      ? Math.round((Number(c.total) / kpi.total_expenses) * 100) : 0;
                    return (
                      <div key={c.category}>
                        <div className="flex items-center justify-between text-sm mb-1">
                          <span className="text-gray-700">{c.category}</span>
                          <span className="font-medium text-gray-900">
                            {formatMoney(c.total)}
                            <span className="text-gray-400 font-normal ml-1">{share}%</span>
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${share}%`, background: '#F59E0B' }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Every entry</p>
                <div className="overflow-y-auto" style={{ maxHeight: 260 }}>
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-white">
                      <tr className="text-left text-gray-500 border-b border-gray-200">
                        <th className="py-1.5 font-semibold">Date</th>
                        <th className="py-1.5 font-semibold">Category</th>
                        <th className="py-1.5 font-semibold">Recorded by</th>
                        <th className="py-1.5 font-semibold text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {expenseDetail.map(e => (
                        <tr key={e.id} className="border-b border-gray-100">
                          <td className="py-1.5 text-gray-600 whitespace-nowrap">
                            {moment(e.created_at).format('DD MMM, HH:mm')}
                          </td>
                          <td className="py-1.5 text-gray-800">
                            {e.category}
                            {e.description ? <span className="text-gray-400"> — {e.description}</span> : null}
                          </td>
                          <td className="py-1.5 text-gray-600">{e.staff_name || '—'}</td>
                          <td className="py-1.5 text-right font-medium text-gray-900 whitespace-nowrap">
                            {formatMoney(e.amount)}
                            {/* Marks money taken out of the till, which is what
                                a shift's expected cash is reconciled against. */}
                            {e.from_drawer ? <span className="text-amber-600 ml-1" title="Paid out of the drawer">&bull;</span> : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-gray-400 mt-2">
                  <span className="text-amber-600">&bull;</span> paid out of the cash drawer
                </p>
              </div>
            </div>
          </div>
        )}

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
                            {cell.day} {cell.hour > 12 ? cell.hour-12+'PM' : cell.hour+'AM'} — {cell.orders} orders — {formatMoney(cell.revenue)}
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
                      <td className="py-3 text-right font-semibold text-gray-900">{formatMoney(cp.total_revenue)}</td>
                      <td className="py-3 text-right text-gray-600">{formatMoney(cp.avg_order_value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ height: 200, marginTop: 16 }}>
                <ResponsiveContainer width="100%" height="100%">
                  {/*
                    layout="vertical" is what Recharts calls bars that run left
                    to right with the categories down the Y axis. This said
                    "horizontal", which is the default and expects the opposite
                    — a category X axis and a numeric Y — so the axes below were
                    inverted against it and the chart drew nothing. The Top
                    Items chart above has always been right; this one never was.
                  */}
                  <BarChart data={cashierPerformance} layout="vertical" margin={{ left: 20, right: 30, top: 10, bottom: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E5E7EB" />
                    <XAxis type="number" tick={{ fontSize: 11, fill: '#6B7280' }} tickFormatter={val => formatMoney(val)} />
                    <YAxis type="category" dataKey="cashier_name" tick={{ fontSize: 11, fill: '#4B5563' }} width={90} axisLine={false} tickLine={false} />
                    <RechartsTooltip cursor={{ fill: '#F9FAFB' }} contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} formatter={(value) => [formatMoney(value), 'Revenue']} />
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
                <button
                  onClick={() => setReportFormat('expenses')}
                  className={`px-4 py-1.5 text-xs font-semibold rounded-md ${reportFormat === 'expenses' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}
                >
                  Expenses
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
                      <th className="py-3 px-4 text-right">Net Sales</th>
                      <th className="py-3 px-4 text-right">Expenses</th>
                      {/* Net of expenses — the figure the day actually left
                          behind, and the one the KPI row leads with. */}
                      <th className="py-3 px-4 text-right text-orange-600">Net Revenue</th>
                    </>
                  ) : reportFormat === 'expenses' ? (
                    <>
                      <th className="py-3 px-4">Date</th>
                      <th className="py-3 px-4">Category</th>
                      <th className="py-3 px-4">Description</th>
                      <th className="py-3 px-4">Recorded By</th>
                      <th className="py-3 px-4 text-center">From Drawer</th>
                      <th className="py-3 px-4 text-right text-orange-600">Amount</th>
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
                      <th className="py-3 px-4 text-center">Staff</th>
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
                      if (!acc[date]) acc[date] = { date, orders: 0, revenue: 0, discounts: 0, net: 0, expenses: 0 };
                      acc[date].orders += 1;
                      // Gross (pre-discount) vs net (what was actually taken).
                      // These were both summing `total`, so the two money
                      // columns always matched and the discount column between
                      // them reconciled with neither.
                      acc[date].revenue += Number(row.subtotal) || 0;
                      acc[date].discounts += Number(row.discount) || 0;
                      acc[date].net += Number(row.total) || 0;
                      return acc;
                    }, expenseDetail.reduce((acc, e) => {
                      // Seed the grouping with the expense days, so a day the
                      // shop was shut but still paid out still gets a row.
                      const date = moment(e.created_at).format('YYYY-MM-DD');
                      if (!acc[date]) acc[date] = { date, orders: 0, revenue: 0, discounts: 0, net: 0, expenses: 0 };
                      acc[date].expenses += Number(e.amount) || 0;
                      return acc;
                    }, {}))
                  ).sort((a,b) => a[0].localeCompare(b[0])).map(([date, d], i) => (
                    <tr key={date} className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
                      <td className="py-3 px-4 font-medium text-gray-900">{moment(date).format('MMM D, YYYY')}</td>
                      <td className="py-3 px-4 text-center text-gray-600">{d.orders}</td>
                      <td className="py-3 px-4 text-right text-gray-600">{formatMoney(d.revenue)}</td>
                      <td className="py-3 px-4 text-right text-red-500">-{formatMoney(d.discounts)}</td>
                      <td className="py-3 px-4 text-right text-gray-600">{formatMoney(d.net)}</td>
                      <td className="py-3 px-4 text-right text-amber-600">{d.expenses > 0 ? `-${formatMoney(d.expenses)}` : '—'}</td>
                      <td className="py-3 px-4 text-right font-bold text-gray-900">{formatMoney(d.net - d.expenses)}</td>
                    </tr>
                  ))
                ) : reportFormat === 'expenses' ? (
                  expenseDetail.map((e, i) => (
                    <tr key={e.id} className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
                      <td className="py-3 px-4 text-gray-500 text-xs whitespace-nowrap">{moment(e.created_at).format('MMM D, hh:mm A')}</td>
                      <td className="py-3 px-4 font-medium text-gray-900">{e.category}</td>
                      <td className="py-3 px-4 text-gray-600 text-xs">{e.description || '—'}</td>
                      <td className="py-3 px-4 text-gray-600 text-xs">{e.staff_name || 'Unknown'}</td>
                      <td className="py-3 px-4 text-center">
                        {e.from_drawer ? (
                          <span className="px-2 py-1 rounded text-[10px] font-bold bg-amber-100 text-amber-700">DRAWER</span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-gray-900">{formatMoney(e.amount)}</td>
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
                      <td className="py-3 px-4 text-right text-gray-600">{formatMoney(row.unit_price)}</td>
                      <td className="py-3 px-4 text-right font-bold text-gray-900">{formatMoney(row.line_total)}</td>
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
                      <td className="py-3 px-4 text-center">
                        {row.is_employee ? (
                          <span
                            className="px-2 py-1 rounded text-[10px] font-bold bg-amber-100 text-amber-700"
                            title={`Staff purchase — ${formatMoney(row.employee_discount || 0)} off`}
                          >
                            STAFF
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right text-gray-600">{formatMoney(row.subtotal || 0)}</td>
                      <td className="py-3 px-4 text-right text-red-500">{row.discount > 0 ? `-${formatMoney(row.discount)}` : '—'}</td>
                      <td className="py-3 px-4 text-right font-bold text-gray-900">{formatMoney(row.total || 0)}</td>
                    </tr>
                  ))
                )}
                {(reportFormat === 'items' ? lineItems.length
                  : reportFormat === 'expenses' ? expenseDetail.length
                  // Summary now has expense-only days, so it is empty only
                  // when there were neither sales nor payouts.
                  : reportFormat === 'summary' ? detailedReport.length + expenseDetail.length
                  : detailedReport.length) === 0 && (
                  <tr>
                    <td
                      colSpan={reportFormat === 'summary' ? 7 : reportFormat === 'expenses' ? 6 : reportFormat === 'items' ? 7 : 8}
                      className="py-8 text-center text-gray-400"
                    >
                      {reportFormat === 'expenses'
                        ? 'No expenses recorded for this date range.'
                        : 'No orders found for this date range.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/*
            Taking the figures out of the building — printed or downloaded — is
            an administrator action. A manager reads the day's numbers on
            screen. Print sits behind the same gate as the exports because a
            printout leaves the shop just as easily as a spreadsheet.
          */}
          {isAdmin ? (
            <div className="flex gap-4 mt-6 print:hidden">
              <button
                onClick={printReport}
                className="flex items-center gap-2 px-6 py-2.5 bg-gray-900 text-white rounded-lg text-sm font-bold hover:bg-gray-800 transition-colors"
              >
                <Printer size={16} /> Print Report
              </button>
              <button
                onClick={exportExcel}
                className="flex items-center gap-2 px-6 py-2.5 bg-gray-900 text-white rounded-lg text-sm font-bold hover:bg-gray-800 transition-colors"
              >
                <FileSpreadsheet size={16} /> Export Excel
              </button>
              <button
                onClick={exportCSV}
                className="flex items-center gap-2 px-6 py-2.5 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-bold hover:bg-gray-50 transition-colors"
              >
                <Download size={16} /> Export CSV
              </button>
            </div>
          ) : (
            <div className="mt-6 text-xs text-gray-400 print:hidden">
              Exporting and printing reports is restricted to an administrator.
            </div>
          )}
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
// @ts-nocheck
import React, { useState, useEffect, useRef } from 'react';
import { Store, Percent, Receipt, Printer, Clock, Database, Download, Send } from 'lucide-react';
import PageHeader from '@/components/pos-ui/PageHeader';
import Toggle from '@/components/pos-ui/Toggle';
import Toast from '@/components/pos-ui/Toast';
import Modal from '@/components/pos-ui/Modal';
import { settingsAPI, reportsAPI } from '@/api/index';

const NAV_ITEMS = [
  { id: 'restaurant', label: 'Restaurant', icon: Store },
  { id: 'tax', label: 'Tax & Pricing', icon: Percent },
  { id: 'receipt', label: 'Receipt', icon: Receipt },
  { id: 'printer', label: 'Printer', icon: Printer },
  { id: 'shift', label: 'Shift', icon: Clock },
  { id: 'backup', label: 'Data & Backup', icon: Database },
  { id: 'reports', label: 'Reports', icon: Send },
];

const CARD_STYLE = {
  background: '#FFFFFF',
  border: '1px solid #E5E7EB',
  borderRadius: 12,
  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
};

const INPUT_STYLE = {
  height: 40,
  border: '1px solid #E5E7EB',
  borderRadius: 8,
  padding: '0 12px',
  fontSize: 14,
  width: '100%',
  outline: 'none',
  fontFamily: "'Inter', sans-serif",
};

function SegmentedButton({ options, value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
              background: active ? '#F97316' : '#FFFFFF',
              color: active ? '#FFFFFF' : '#374151',
              border: active ? '1px solid #F97316' : '1px solid #E5E7EB',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function FieldLabel({ label, helper }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <label style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>{label}</label>
      {helper && <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>{helper}</div>}
    </div>
  );
}

export default function Settings() {
  const [activeSection, setActiveSection] = useState('restaurant');
  const [toast, setToast] = useState(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  const [profile, setProfile] = useState({
    name: 'Al-Madina Fast Food', tagline: '', address: '', phone: '', footerMessage: 'Thank you for visiting!',
  });
  const [profileOriginal, setProfileOriginal] = useState(null);
  const [logoPreview, setLogoPreview] = useState(null);
  const fileInputRef = useRef(null);

  const [tax, setTax] = useState({ rate: 0, currency: 'Rs.', position: 'before', enableTax: false });

  const [receiptSettings, setReceiptSettings] = useState({
    autoPrint: true, showTax: true, showCashier: true, showOrderNumber: true, showPayment: true, paperSize: '80mm',
  });

  const [printerType, setPrinterType] = useState('USB');
  const [printerIP, setPrinterIP] = useState('');
  const [printerConnected, setPrinterConnected] = useState(false);

  const [shiftOpen, setShiftOpen] = useState(false);
  const [shiftStart, setShiftStart] = useState(null);
  const [shiftOrders, setShiftOrders] = useState(23);
  const [shiftRevenue, setShiftRevenue] = useState(12400);
  const [openShiftModal, setOpenShiftModal] = useState(false);
  const [closeShiftModal, setCloseShiftModal] = useState(false);
  const [openingCash, setOpeningCash] = useState('');
  const [actualCash, setActualCash] = useState('');
  const [shiftHistory, setShiftHistory] = useState([
    { id: 1, date: 'Jun 23, 2026', start: '9:00 AM', end: '5:30 PM', orders: 45, revenue: 28500 },
    { id: 2, date: 'Jun 22, 2026', start: '9:00 AM', end: '6:00 PM', orders: 52, revenue: 31200 },
    { id: 3, date: 'Jun 21, 2026', start: '10:00 AM', end: '4:00 PM', orders: 38, revenue: 22100 },
  ]);
  const [duration, setDuration] = useState('0h 0m');

  const [lastBackup, setLastBackup] = useState('Never');
  const [resetModal, setResetModal] = useState(false);
  const [resetConfirm, setResetConfirm] = useState('');
  const restoreInputRef = useRef(null);

  useEffect(() => {
    settingsAPI.getAll().then((data) => {
      const p = {
        name: data.restaurant_name || 'Al-Madina Fast Food',
        tagline: data.restaurant_tagline || '',
        address: data.restaurant_address || '',
        phone: data.restaurant_phone || '',
        footerMessage: data.receipt_footer || 'Thank you for visiting!',
      };
      setProfile(p);
      setProfileOriginal(p);
      setTax({
        rate: Number(data.tax_rate) || 0,
        currency: data.currency_symbol || 'Rs.',
        position: data.currency_position || 'before',
        enableTax: Number(data.tax_rate) > 0,
      });
      setReceiptSettings({
        autoPrint: data.auto_print === 'true',
        showTax: data.show_tax !== 'false',
        showCashier: data.show_cashier !== 'false',
        showOrderNumber: data.show_order_number !== 'false',
        showPayment: data.show_payment !== 'false',
        paperSize: data.paper_size || '80mm',
      });
      if (data.last_backup) setLastBackup(data.last_backup);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!shiftOpen || !shiftStart) return;
    const interval = setInterval(() => {
      const diff = Date.now() - shiftStart;
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      setDuration(`${h}h ${m}m`);
    }, 1000);
    return () => clearInterval(interval);
  }, [shiftOpen, shiftStart]);

  const profileChanged = profileOriginal && JSON.stringify(profile) !== JSON.stringify(profileOriginal);

  const handleSaveProfile = async () => {
    await settingsAPI.update({
      restaurant_name: profile.name,
      restaurant_tagline: profile.tagline,
      restaurant_address: profile.address,
      restaurant_phone: profile.phone,
      receipt_footer: profile.footerMessage,
    });
    setProfileOriginal({ ...profile });
    setToast({ message: 'Settings saved successfully', type: 'success' });
  };

  const handleLogoUpload = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => setLogoPreview(ev.target.result);
      reader.readAsDataURL(file);
    }
  };

  const handleBackup = async () => {
    try {
      await settingsAPI.backup();
      const now = new Date().toLocaleString();
      setLastBackup(now);
      setToast({ message: 'Backup downloaded successfully', type: 'success' });
    } catch {
      setToast({ message: 'Backup failed', type: 'error' });
    }
  };

  const handleStartShift = () => {
    setShiftOpen(true);
    setShiftStart(Date.now());
    setOpenShiftModal(false);
    setOpeningCash('');
    setToast({ message: 'Shift started', type: 'success' });
  };

  const handleCloseShift = () => {
    const now = new Date();
    setShiftHistory((prev) => [{
      id: Date.now(),
      date: now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      start: shiftStart ? new Date(shiftStart).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '9:00 AM',
      end: now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
      orders: shiftOrders,
      revenue: shiftRevenue,
    }, ...prev].slice(0, 5));
    setShiftOpen(false);
    setShiftStart(null);
    setCloseShiftModal(false);
    setActualCash('');
    setToast({ message: 'Shift closed', type: 'success' });
  };

  const expectedCash = shiftOpen ? (Number(openingCash) || 0) + shiftRevenue : 0;
  const cashDiff = Number(actualCash) - expectedCash;

  const renderRestaurant = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div
          style={{
            width: 80, height: 80, borderRadius: 9999,
            border: '2px dashed #E5E7EB', background: '#F9FAFB',
            display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
          }}
        >
          {logoPreview ? (
            <img src={logoPreview} alt="Logo" style={{ width: 80, height: 80, objectFit: 'cover' }} />
          ) : (
            <Store size={32} color="#D1D5DB" />
          )}
        </div>
        <div>
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              background: '#FFFFFF', border: '1px solid #F97316', color: '#F97316',
              height: 40, borderRadius: 8, fontWeight: 600, fontSize: 14, padding: '0 20px', cursor: 'pointer',
            }}
          >
            Upload Logo
          </button>
          <div style={{ fontSize: 12, color: '#6B7280', marginTop: 6 }}>PNG or JPG, min 256x256</div>
          <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleLogoUpload} />
        </div>
      </div>

      <div>
        <FieldLabel label="Restaurant Name" />
        <input style={INPUT_STYLE} value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
      </div>
      <div>
        <FieldLabel label="Tagline" helper="Shown below restaurant name on receipts" />
        <input style={INPUT_STYLE} value={profile.tagline} onChange={(e) => setProfile({ ...profile, tagline: e.target.value })} />
      </div>
      <div>
        <FieldLabel label="Address" />
        <input style={INPUT_STYLE} value={profile.address} onChange={(e) => setProfile({ ...profile, address: e.target.value })} />
      </div>
      <div>
        <FieldLabel label="Phone Number" />
        <input style={INPUT_STYLE} value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} />
      </div>
      <div>
        <FieldLabel label="Receipt Footer Message" helper="Printed at the bottom of every receipt" />
        <input style={INPUT_STYLE} value={profile.footerMessage} onChange={(e) => setProfile({ ...profile, footerMessage: e.target.value })} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={handleSaveProfile}
          disabled={!profileChanged}
          style={{
            background: profileChanged ? '#F97316' : '#E5E7EB',
            color: profileChanged ? '#FFFFFF' : '#9CA3AF',
            height: 40, borderRadius: 8, fontWeight: 600, fontSize: 14, padding: '0 20px',
            border: 'none', cursor: profileChanged ? 'pointer' : 'not-allowed',
          }}
        >
          Save
        </button>
      </div>
    </div>
  );

  const renderTax = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <Toggle
        value={tax.enableTax}
        onChange={(v) => setTax({ ...tax, enableTax: v })}
        label="Enable Tax on Orders"
        hint="Adds tax to every order total"
      />
      <div>
        <FieldLabel label="Tax Rate" helper="Percentage added to subtotal" />
        <input
          type="number"
          disabled={!tax.enableTax}
          value={tax.rate}
          onChange={(e) => setTax({ ...tax, rate: Number(e.target.value) })}
          style={{ ...INPUT_STYLE, width: 120, opacity: tax.enableTax ? 1 : 0.5 }}
        />
      </div>
      <div>
        <FieldLabel label="Currency Symbol" />
        <SegmentedButton
          options={[{ value: 'Rs.', label: 'Rs.' }, { value: '$', label: '$' }, { value: '£', label: '£' }, { value: 'AED', label: 'AED' }]}
          value={tax.currency}
          onChange={(v) => setTax({ ...tax, currency: v })}
        />
      </div>
      <div>
        <FieldLabel label="Currency Position" />
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          {[
            { value: 'before', preview: `${tax.currency} 500` },
            { value: 'after', preview: `500 ${tax.currency}` },
          ].map((opt) => (
            <button
              key={opt.value}
              onClick={() => setTax({ ...tax, position: opt.value })}
              style={{
                padding: '10px 16px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
                background: tax.position === opt.value ? '#F97316' : '#FFFFFF',
                color: tax.position === opt.value ? '#FFFFFF' : '#374151',
                border: tax.position === opt.value ? '1px solid #F97316' : '1px solid #E5E7EB',
              }}
            >
              {opt.value === 'before' ? `Before amount (${opt.preview})` : `After amount (${opt.preview})`}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  const renderReceipt = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Toggle value={receiptSettings.autoPrint} onChange={(v) => setReceiptSettings({ ...receiptSettings, autoPrint: v })} label="Auto-print after charge" hint="Automatically sends to printer when order is completed" />
      <Toggle value={receiptSettings.showTax} onChange={(v) => setReceiptSettings({ ...receiptSettings, showTax: v })} label="Show tax on receipt" hint="Displays tax breakdown line" />
      <Toggle value={receiptSettings.showCashier} onChange={(v) => setReceiptSettings({ ...receiptSettings, showCashier: v })} label="Show cashier name" hint="Prints who processed the order" />
      <Toggle value={receiptSettings.showOrderNumber} onChange={(v) => setReceiptSettings({ ...receiptSettings, showOrderNumber: v })} label="Show order number" hint="Prints the order # at the top" />
      <Toggle value={receiptSettings.showPayment} onChange={(v) => setReceiptSettings({ ...receiptSettings, showPayment: v })} label="Show payment method" hint="Prints Cash or Card" />
      <div>
        <FieldLabel label="Paper Size" />
        <SegmentedButton
          options={[{ value: '58mm', label: '58mm' }, { value: '80mm', label: '80mm' }]}
          value={receiptSettings.paperSize}
          onChange={(v) => setReceiptSettings({ ...receiptSettings, paperSize: v })}
        />
      </div>
    </div>
  );

  const renderPrinter = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <FieldLabel label="Printer Type" />
        <SegmentedButton
          options={[{ value: 'USB', label: 'USB' }, { value: 'Network', label: 'Network' }, { value: 'Bluetooth', label: 'Bluetooth' }]}
          value={printerType}
          onChange={setPrinterType}
        />
      </div>
      {printerType === 'Network' && (
        <div>
          <FieldLabel label="Printer IP Address" />
          <input style={{ ...INPUT_STYLE, width: 200 }} placeholder="192.168.1.100" value={printerIP} onChange={(e) => setPrinterIP(e.target.value)} />
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 8, height: 8, borderRadius: 9999, background: printerConnected ? '#22C55E' : '#EF4444' }} />
        <span style={{ fontSize: 13, color: '#374151' }}>{printerConnected ? 'Printer Connected' : 'No Printer Found'}</span>
      </div>
      <button
        onClick={() => setToast({ message: 'Test print sent successfully', type: 'success' })}
        className="flex items-center gap-2"
        style={{
          background: '#FFFFFF', border: '1px solid #F97316', color: '#F97316',
          height: 40, borderRadius: 8, fontWeight: 600, fontSize: 14, padding: '0 20px', cursor: 'pointer',
        }}
      >
        <Printer size={16} /> Send Test Print
      </button>
    </div>
  );

  const renderShift = () => (
    <div>
      {!shiftOpen ? (
        <div
          style={{
            border: '2px dashed #E5E7EB', borderRadius: 12, padding: 40,
            textAlign: 'center', marginBottom: 24,
          }}
        >
          <Clock size={40} color="#9CA3AF" style={{ margin: '0 auto 12px' }} />
          <div style={{ fontSize: 16, fontWeight: 600, color: '#374151', marginBottom: 16 }}>No Active Shift</div>
          <button
            onClick={() => setOpenShiftModal(true)}
            style={{
              background: '#F97316', color: '#FFFFFF', height: 40, borderRadius: 8,
              fontWeight: 600, fontSize: 14, padding: '0 20px', border: 'none', cursor: 'pointer',
            }}
          >
            Open Shift
          </button>
        </div>
      ) : (
        <div style={{ border: '2px solid #22C55E', borderRadius: 12, padding: 24, marginBottom: 24 }}>
          <div style={{ fontSize: 14, color: '#374151', marginBottom: 8 }}>
            Shift Started: {shiftStart ? new Date(shiftStart).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '9:00 AM'}
          </div>
          <div style={{ fontSize: 14, color: '#374151', marginBottom: 8 }}>Duration: {duration}</div>
          <div style={{ fontSize: 14, color: '#374151', marginBottom: 8 }}>Orders so far: {shiftOrders}</div>
          <div style={{ fontSize: 14, color: '#374151', marginBottom: 16 }}>Revenue so far: Rs. {shiftRevenue.toLocaleString()}</div>
          <button
            onClick={() => setCloseShiftModal(true)}
            style={{
              background: '#FFFFFF', border: '1px solid #EF4444', color: '#EF4444',
              height: 40, borderRadius: 8, fontWeight: 600, fontSize: 14, padding: '0 20px', cursor: 'pointer',
            }}
          >
            Close Shift
          </button>
        </div>
      )}

      <div style={{ fontSize: 14, fontWeight: 700, color: '#111827', marginBottom: 12 }}>Recent Shifts</div>
      {shiftHistory.map((s) => (
        <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #F3F4F6' }}>
          <div style={{ fontSize: 13, color: '#374151' }}>
            {s.date} · {s.start}–{s.end} · {s.orders} orders · Rs. {s.revenue.toLocaleString()}
          </div>
          <button style={{ background: 'none', border: 'none', color: '#F97316', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>View</button>
        </div>
      ))}
    </div>
  );

  const renderBackup = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ ...CARD_STYLE, padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>Backup Data</div>
        <div style={{ fontSize: 13, color: '#6B7280', marginTop: 4 }}>Save a copy of all your data to your computer</div>
        <div style={{ fontSize: 13, color: '#6B7280', marginTop: 8 }}>Last backup: {lastBackup}</div>
        <button
          onClick={handleBackup}
          className="flex items-center gap-2"
          style={{
            marginTop: 16, background: '#F97316', color: '#FFFFFF',
            height: 40, borderRadius: 8, fontWeight: 600, fontSize: 14, padding: '0 20px', border: 'none', cursor: 'pointer',
          }}
        >
          <Download size={16} /> Backup Now
        </button>
      </div>

      <div style={{ ...CARD_STYLE, padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>Restore from Backup</div>
        <div style={{ fontSize: 13, color: '#6B7280', marginTop: 4 }}>Load data from a previous backup file</div>
        <div style={{
          marginTop: 12, background: '#FFF7ED', border: '1px solid #FED7AA',
          borderRadius: 8, padding: 12, fontSize: 13, color: '#92400E',
        }}>
          ⚠️ Restoring will replace all current data. This cannot be undone.
        </div>
        <button
          onClick={() => restoreInputRef.current?.click()}
          style={{
            marginTop: 16, background: '#FFFFFF', border: '1px solid #F97316', color: '#F97316',
            height: 40, borderRadius: 8, fontWeight: 600, fontSize: 14, padding: '0 20px', cursor: 'pointer',
          }}
        >
          Choose Backup File
        </button>
        <input ref={restoreInputRef} type="file" accept=".db" style={{ display: 'none' }} />
      </div>

      <div style={{
        border: '1px solid #FEE2E2', background: '#FFF5F5', borderRadius: 12, padding: 20,
      }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#DC2626' }}>Danger Zone</div>
        <div style={{ fontSize: 13, color: '#6B7280', marginTop: 4 }}>
          Permanently delete all orders, menu items, and settings. This cannot be undone.
        </div>
        <button
          onClick={() => setResetModal(true)}
          style={{
            marginTop: 16, background: '#FFFFFF', border: '1px solid #EF4444', color: '#EF4444',
            height: 40, borderRadius: 8, fontWeight: 600, fontSize: 14, padding: '0 20px', cursor: 'pointer',
          }}
        >
          Reset All Data
        </button>
      </div>
    </div>
  );

  const handleSendReport = async () => {
    try {
      setIsGeneratingPdf(true);
      
      // 1. Try Automatic WhatsApp Send First
      setToast({ message: 'Sending automatic report...', type: 'info' });
      let autoSuccess = false;
      try {
        const response = await fetch('http://localhost:3001/api/whatsapp/send-daily-report', { method: 'POST' });
        if (response.ok) {
          autoSuccess = true;
          setToast({ message: 'Report sent automatically via WhatsApp!', type: 'success' });
        } else {
          console.warn('Auto-send failed, falling back to manual generation.');
        }
      } catch (err) {
        console.warn('Auto-send error, falling back to manual generation.', err);
      }

      if (autoSuccess) {
        setIsGeneratingPdf(false);
        return;
      }

      // 2. Fallback: Manual PDF Generation & Share
      setToast({ message: 'Generating manual report PDF...', type: 'info' });
      const today = new Date().toISOString().split('T')[0];
      const data = await reportsAPI.kpi({ startDate: today, endDate: today }).catch(() => ({}));
      
      const totalRevenue = data.total_revenue || 0;
      const totalOrders = data.total_orders || 0;
      
      const topItemsData = await reportsAPI.topItems({ startDate: today, endDate: today }).catch(() => []);
      const topItems = Array.isArray(topItemsData) ? topItemsData.slice(0, 5) : [];
      
      const dateStr = new Date().toLocaleDateString('en-PK', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      
      // 1. Generate PDF
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF();
      
      // Header
      doc.setFillColor(249, 115, 22); // Orange header
      doc.rect(0, 0, 210, 40, 'F');
      
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(22);
      doc.setFont("helvetica", "bold");
      doc.text("TASTY BITES - DAILY REPORT", 105, 20, { align: "center" });
      
      doc.setFontSize(12);
      doc.setFont("helvetica", "normal");
      doc.text(`Date: ${dateStr}`, 105, 30, { align: "center" });
      
      doc.setTextColor(0, 0, 0);
      
      // Overview Section
      doc.setFontSize(16);
      doc.setFont("helvetica", "bold");
      doc.text("Daily Insights (Aaj Ka Khulasa)", 20, 60);
      
      doc.setDrawColor(200, 200, 200);
      doc.line(20, 65, 190, 65);
      
      doc.setFontSize(12);
      doc.setFont("helvetica", "normal");
      doc.text(`Total Orders (Kul Orders):`, 20, 75);
      doc.setFont("helvetica", "bold");
      doc.text(`${totalOrders}`, 150, 75);
      
      doc.setFont("helvetica", "normal");
      doc.text(`Total Revenue (Kul Aamdani):`, 20, 85);
      doc.setFont("helvetica", "bold");
      doc.text(`Rs. ${totalRevenue.toLocaleString()}`, 150, 85);
      
      let y = 105;
      if (topItems.length > 0) {
        doc.setFontSize(16);
        doc.setFont("helvetica", "bold");
        doc.text("Top Selling Items (Sab Se Zyada Bikne Wale)", 20, 105);
        doc.line(20, 110, 190, 110);
        y = 120;
        
        doc.setFontSize(12);
        topItems.forEach((item, index) => {
          doc.setFont("helvetica", "normal");
          doc.text(`${index + 1}. ${item.name || 'Item'}`, 20, y);
          doc.setFont("helvetica", "bold");
          doc.text(`Qty: ${item.total_qty || 0}`, 150, y);
          y += 10;
        });
        y += 10;
      }
      
      // Footer / AI Insight
      doc.setFontSize(16);
      doc.setFont("helvetica", "bold");
      doc.text("Summary (Nateeja)", 20, y);
      doc.line(20, y + 5, 190, y + 5);
      
      doc.setFontSize(12);
      doc.setFont("helvetica", "normal");
      const insightText = totalOrders > 0 
        ? `Aaj ki sales report kafi achi hai! Total ${totalOrders} orders receive hue hain aur overall revenue Rs. ${totalRevenue.toLocaleString()} raha. Keep it up and try to push more sales on the top items!`
        : `Aaj abhi tak koi order receive nahi hua.`;
      
      const splitText = doc.splitTextToSize(insightText, 170);
      doc.text(splitText, 20, y + 15);
      
      const pdfBlob = doc.output('blob');
      const fileName = `TastyBites_Daily_Report_${today}.pdf`;
      const pdfFile = new File([pdfBlob], fileName, { type: 'application/pdf' });
      
      const textMsg = `*Aaj Ki Report (${dateStr})*\n\n*Orders:* ${totalOrders}\n*Revenue:* Rs. ${totalRevenue}\n\n_Detailed report PDF file attach kar di gayi hai!_`;
      
      // 2. Share or Download
      let shared = false;
      if (navigator.canShare && navigator.canShare({ files: [pdfFile] })) {
        try {
          await navigator.share({
            title: 'Daily Report',
            text: textMsg,
            files: [pdfFile]
          });
          setToast({ message: 'Shared successfully', type: 'success' });
          shared = true;
        } catch (e) {
          console.log('Share API failed or cancelled', e);
        }
      }
      
      if (!shared) {
        // Fallback: Download the file and open WhatsApp web
        doc.save(fileName);
        
        const encodedText = encodeURIComponent(textMsg + "\n\n(Please attach the downloaded PDF file)");
        const phone = '923195304725';
        const url = `https://wa.me/${phone}?text=${encodedText}`;
        
        window.open(url, '_blank');
        setToast({ message: 'Downloaded PDF. Please attach it on WhatsApp...', type: 'warning' });
      }
      
    } catch (error) {
      console.error('Report error:', error);
      setToast({ message: 'Failed to generate report', type: 'error' });
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const renderReports = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ ...CARD_STYLE, padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>Daily Summary Report</div>
        <div style={{ fontSize: 13, color: '#6B7280', marginTop: 4 }}>Send today's sales and orders summary via WhatsApp</div>
        <button
          onClick={handleSendReport}
          disabled={isGeneratingPdf}
          className="flex items-center gap-2"
          style={{
            marginTop: 16, background: isGeneratingPdf ? '#86EFAC' : '#25D366', color: '#FFFFFF',
            height: 40, borderRadius: 8, fontWeight: 600, fontSize: 14, padding: '0 20px', border: 'none', 
            cursor: isGeneratingPdf ? 'not-allowed' : 'pointer', transition: 'all 0.2s ease-in-out'
          }}
        >
          {isGeneratingPdf ? (
            <>
              <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Generating PDF...
            </>
          ) : (
            <>
              <Send size={16} /> Send to WhatsApp (03195304725)
            </>
          )}
        </button>
      </div>
    </div>
  );

  const sectionRenderers = {
    restaurant: renderRestaurant,
    tax: renderTax,
    receipt: renderReceipt,
    printer: renderPrinter,
    shift: renderShift,
    backup: renderBackup,
    reports: renderReports,
  };

  return (
    <div style={{ flex: 1, height: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', background: '#FFFFFF', fontFamily: "'Inter', sans-serif" }}>
      <div style={{ padding: 24, flex: 1, overflow: 'auto' }}>
        <PageHeader title="Settings" />
        <div style={{ display: 'flex', gap: 20 }}>
          <nav style={{ ...CARD_STYLE, width: 200, flexShrink: 0, padding: 8 }}>
            {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
              const active = activeSection === id;
              return (
                <button
                  key={id}
                  onClick={() => setActiveSection(id)}
                  className="flex items-center"
                  style={{
                    width: '100%', gap: 10, padding: '10px 14px', borderRadius: 8,
                    fontSize: 14, fontWeight: 500, border: 'none', cursor: 'pointer',
                    background: active ? '#FFF7ED' : 'transparent',
                    color: active ? '#F97316' : '#6B7280',
                  }}
                >
                  <Icon size={18} style={{ color: active ? '#F97316' : '#6B7280' }} />
                  {label}
                </button>
              );
            })}
          </nav>
          <div style={{ ...CARD_STYLE, flex: 1, padding: 28, minHeight: 500 }}>
            {sectionRenderers[activeSection]?.()}
          </div>
        </div>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <Modal isOpen={openShiftModal} onClose={() => setOpenShiftModal(false)} title="Open Shift">
        <div>
          <FieldLabel label="Opening Cash Amount (Rs.)" />
          <input style={INPUT_STYLE} type="number" value={openingCash} onChange={(e) => setOpeningCash(e.target.value)} />
          <button
            onClick={handleStartShift}
            style={{
              marginTop: 20, background: '#F97316', color: '#FFFFFF',
              height: 40, borderRadius: 8, fontWeight: 600, fontSize: 14, padding: '0 20px', border: 'none', cursor: 'pointer',
            }}
          >
            Start Shift
          </button>
        </div>
      </Modal>

      <Modal isOpen={closeShiftModal} onClose={() => setCloseShiftModal(false)} title="Close Shift" width={520}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 14, color: '#374151' }}>Start: {shiftStart ? new Date(shiftStart).toLocaleTimeString() : '—'}</div>
          <div style={{ fontSize: 14, color: '#374151' }}>End: {new Date().toLocaleTimeString()}</div>
          <div style={{ fontSize: 14, color: '#374151' }}>Total orders: {shiftOrders}</div>
          <div style={{ fontSize: 14, color: '#374151' }}>Total revenue: Rs. {shiftRevenue.toLocaleString()}</div>
          <div style={{ fontSize: 14, color: '#374151' }}>Total discounts given: Rs. 0</div>
          <div style={{ fontSize: 14, color: '#374151' }}>Expected cash in drawer: Rs. {expectedCash.toLocaleString()}</div>
          <div>
            <FieldLabel label="Actual Cash Count" />
            <input style={INPUT_STYLE} type="number" value={actualCash} onChange={(e) => setActualCash(e.target.value)} />
          </div>
          {actualCash && (
            <div style={{ fontSize: 14, fontWeight: 600, color: cashDiff >= 0 ? '#16A34A' : '#DC2626' }}>
              Cash Difference: {cashDiff >= 0 ? '+' : ''}Rs. {cashDiff.toLocaleString()}
            </div>
          )}
          <button
            onClick={handleCloseShift}
            style={{
              marginTop: 8, background: '#EF4444', color: '#FFFFFF',
              height: 40, borderRadius: 8, fontWeight: 600, fontSize: 14, padding: '0 20px', border: 'none', cursor: 'pointer',
            }}
          >
            Close Shift
          </button>
        </div>
      </Modal>

      <Modal isOpen={resetModal} onClose={() => { setResetModal(false); setResetConfirm(''); }} title="Reset All Data">
        <p style={{ fontSize: 14, color: '#6B7280', marginBottom: 16 }}>
          This will permanently delete all orders, menu items, and settings. Type CONFIRM to proceed.
        </p>
        <input style={INPUT_STYLE} value={resetConfirm} onChange={(e) => setResetConfirm(e.target.value)} placeholder="Type CONFIRM" />
        <button
          disabled={resetConfirm !== 'CONFIRM'}
          onClick={() => {
            setResetModal(false);
            setResetConfirm('');
            setToast({ message: 'All data has been reset', type: 'warning' });
          }}
          style={{
            marginTop: 16, background: resetConfirm === 'CONFIRM' ? '#EF4444' : '#E5E7EB',
            color: resetConfirm === 'CONFIRM' ? '#FFFFFF' : '#9CA3AF',
            height: 40, borderRadius: 8, fontWeight: 600, fontSize: 14, padding: '0 20px',
            border: 'none', cursor: resetConfirm === 'CONFIRM' ? 'pointer' : 'not-allowed',
          }}
        >
          Reset All Data
        </button>
      </Modal>
    </div>
  );
}

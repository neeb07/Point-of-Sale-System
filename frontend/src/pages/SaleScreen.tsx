import React, { useState, useEffect } from 'react';
import TopBar from '@/components/pos/TopBar';
import MenuPanel from '@/components/pos/MenuPanel';
import OrderCart from '@/components/pos/OrderCart';
import ReceiptModal from '@/components/pos/ReceiptModal';
import Modal from '@/components/pos-ui/Modal';
import { ordersAPI, ApiError } from '@/api/index';
import { Loader2, CreditCard, Clock, AlertTriangle, ArrowRight } from 'lucide-react';
import { usePOS } from '@/lib/POSContext';
import { useAuth } from '@/context/AuthContext';
import moment from 'moment';
import { PAYMENT_METHODS, ORDER_TYPES, type PaymentMethod, type OrderType } from '@/lib/constants';
import { useSettings } from '@/lib/SettingsContext';
import CustomerLookup from '@/components/pos/CustomerLookup';
import AlertDialog, { AlertPanel } from '@/components/pos/AlertDialog';
import HeldOrdersPanel from '@/components/pos/HeldOrdersPanel';
import type { Customer } from '@/api/index';

interface CartItem {
  id: number;
  name: string;
  price: number;
  qty: number;
  isDeal?: boolean;
  variant_id?: number | null;
}

interface RestaurantDetails {
  name: string;
  tagline: string;
  address: string;
  phone: string;
  footerMessage: string;
}

interface ReceiptData {
  orderInfo: {
    date: string;
    time: string;
    orderNumber: string;
    table: string;
    paymentMethod: string;
    cashier: string;
    orderType: string;
    /** A ticket that has not been paid — the bill copies say so. */
    provisional?: boolean;
  };
  items: { name: string; quantity: number; price: number }[];
  subtotal: number;
  discount: number;
  employeeDiscount: number;
  employeeDiscountRate: number;
  isEmployee: boolean;
  taxRate: number;
  taxAmount: number;
  deliveryCharge: number;
  total: number;
  restaurant: RestaurantDetails;
  customer?: { name: string; phone: string; address: string };
}

interface SaleScreenProps {
  onNavigate?: (page: string) => void;
}

export default function SaleScreen({ onNavigate }: SaleScreenProps = {}) {
  /*
   * Why a sale did not go through.
   *
   * This was `alert()`, which on a till is the worst of both worlds: it stops
   * everything, looks nothing like the rest of the screen, and — for the one
   * case that actually happens in service, ringing up before opening a shift —
   * told somebody what was wrong without telling them where to fix it.
   */
  const [saleError, setSaleError] = useState<{ noShift: boolean; message: string } | null>(null);

  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState('');
  const [orderType, setOrderType] = useState<OrderType>('Dine-in');
  /**
   * The delivery charge for this order, as typed. Empty means "the default
   * from Settings"; anything else is what the manager decided for this run —
   * a rider going further than usual, or a regular who is never charged.
   */
  const [deliveryValue, setDeliveryValue] = useState('');

  /**
   * FIX (Bug 6): discount, payment method and table number were hardcoded to
   * 0 / 'Cash' / '—' at checkout even though the database, the reports and
   * the receipt template all supported them. They are real inputs now.
   */
  const [discountValue, setDiscountValue] = useState('');
  const [discountType, setDiscountType] = useState<'flat' | 'percent'>('flat');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('Cash');
  const [tableNumber, setTableNumber] = useState('');
  /** Staff purchase — applies the configured staff discount automatically. */
  const [isEmployee, setIsEmployee] = useState(false);

  /**
   * Delivery details, asked for after the sale is confirmed and before the
   * receipt appears. Every field is optional — a regular the shop already
   * knows can be skipped — but when given they print on all three copies so
   * the kitchen bags the right order and the rider knows where to take it.
   */
  const [deliveryModalOpen, setDeliveryModalOpen] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);
  /*
   * Held orders.
   *
   * Charging no longer records a sale; it sends a ticket to the kitchen. The
   * board lists those tickets, and `editingHold` is set while one of them has
   * been loaded back into the cart to be changed. `receiptCopies` says which
   * copies the receipt modal may offer: the kitchen copy alone when a ticket
   * is sent, the bill copies when one is confirmed.
   */
  const [heldOpen, setHeldOpen] = useState(false);
  const [heldCount, setHeldCount] = useState(0);
  const [editingHold, setEditingHold] = useState<{ id: number; ticket_no: string } | null>(null);
  const [receiptCopies, setReceiptCopies] = useState<string[] | null>(null);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const { loading } = usePOS();
  const { currentUser } = useAuth();

  // Delivery price, tax rate and the shop's details come from the shared
  // settings provider, which already refetches when the window regains focus.
  const { restaurant: restaurantDetails, deliveryPrice, taxRate, employeeDiscountRate, formatMoney, refresh: refreshSettings } = useSettings();

  const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const deliveryCharge = orderType === 'Delivery'
    ? (deliveryValue === '' ? deliveryPrice : Math.max(0, Number(deliveryValue) || 0))
    : 0;

  // Percent discounts are computed off the subtotal, and any discount is
  // capped so an order can never go negative. Delivery is added afterwards
  // so a discount never eats into the rider's fee.
  const rawDiscount = discountType === 'percent'
    ? (subtotal * (Number(discountValue) || 0)) / 100
    : (Number(discountValue) || 0);
  const discount = Math.min(Math.max(0, Math.round(rawDiscount)), subtotal);

  // Tax applies to the discounted subtotal, and delivery is added afterwards,
  // so the rider's fee is neither discounted nor taxed. The server recomputes
  // all of this from its own tax_rate setting — these figures are for display
  // only, and the receipt uses whatever the server actually stored.
  // Staff discount comes off the subtotal first; any manual discount then
  // applies to what remains, so the two can never exceed the order value.
  // The server recomputes all of this from its own settings.
  const employeeDiscount = isEmployee ? Math.round(subtotal * employeeDiscountRate) / 100 : 0;
  const totalDiscount = Math.min(discount + employeeDiscount, subtotal);

  const taxable = Math.max(0, subtotal - totalDiscount);
  const taxAmount = Math.round(taxable * taxRate) / 100;
  const total = taxable + taxAmount + deliveryCharge;

  const handleAddToCart = (item: { id: number; name: string; price: number; isDeal?: boolean; variant_id?: number | null }) => {
    setCart((prev: CartItem[]) => {
      const existing = prev.find((c: CartItem) => c.id === item.id && c.name === item.name);
      if (existing) {
        return prev.map((c: CartItem) =>
          (c.id === item.id && c.name === item.name) ? { ...c, qty: c.qty + 1 } : c
        );
      }
      return [...prev, { id: item.id, name: item.name, price: item.price, qty: 1, isDeal: item.isDeal, variant_id: item.variant_id }];
    });
  };

  const handleUpdateQty = (id: number, name: string, delta: number) => {
    setCart((prev: CartItem[]) =>
      prev
        .map((c: CartItem) => (c.id === id && c.name === name ? { ...c, qty: c.qty + delta } : c))
        .filter((c: CartItem) => c.qty > 0)
    );
  };

  const handleRemoveItem = (id: number, name: string) => {
    setCart((prev: CartItem[]) => prev.filter((c: CartItem) => !(c.id === id && c.name === name)));
  };

  const resetOrder = () => {
    setCart([]);
    setOrderType('Dine-in');
    setDeliveryValue('');
    setDiscountValue('');
    setDiscountType('flat');
    setPaymentMethod('Cash');
    setTableNumber('');
    setIsEmployee(false);
    setCustomerName('');
    setCustomerPhone('');
    setCustomerAddress('');
  };

  const handleClearCart = () => { setEditingHold(null); resetOrder(); };

  const handleOrderTypeChange = (type: OrderType) => {
    setOrderType(type);
    // Pick up a delivery price changed in Settings since this screen loaded.
    // The provider owns the value now, so this refreshes it rather than
    // keeping a second copy in local state.
    if (type === 'Delivery') refreshSettings();
  };

  const handleCharge = () => setConfirmModalOpen(true);

  /**
   * Confirming a delivery asks who it is going to before anything is printed.
   * Anything else goes straight through.
   */
  const confirmCharge = () => {
    setConfirmModalOpen(false);
    if (orderType === 'Delivery') {
      setDeliveryModalOpen(true);
      return;
    }
    placeOrder();
  };

  /**
   * A server order — held, confirmed or reprinted — as the receipt wants it.
   *
   * Always the server's figures. The client's arithmetic is only for the live
   * cart; the paper has to match what was actually recorded. `provisional`
   * marks a ticket that has not been paid for, so the customer and restaurant
   * copies say so rather than pass for a paid bill.
   */
  const receiptFrom = (order: any, opts: { provisional?: boolean; paymentMethod?: string } = {}): ReceiptData => ({
    orderInfo: {
      date: moment().format('DD/MM/YYYY'),
      time: moment().format('hh:mm A'),
      // A confirmed sale carries the branch-coded order number (E-18-041). A
      // ticket carries its ticket number, labelled as such, because it has no
      // order number yet — it is not an order until somebody pays.
      orderNumber: order.order_no
        || (order.ticket_no ? `Ticket ${order.ticket_no}` : (order.id ? `#${order.id}` : '')),
      table: order.table_number || '—',
      paymentMethod: opts.provisional ? 'Not yet paid' : (opts.paymentMethod || order.payment_method || 'Cash'),
      cashier: currentUser?.name || 'Unknown',
      orderType: order.order_type || 'Dine-in',
      provisional: Boolean(opts.provisional),
    },
    items: (order.items || []).map((i: any) => ({ name: i.name, quantity: i.quantity, price: i.price })),
    subtotal: order.subtotal ?? 0,
    // The server's `discount` is the combined figure; the receipt shows the
    // manual and staff portions on separate lines, so take the manual part.
    discount: order.manual_discount ?? 0,
    employeeDiscount: order.employee_discount ?? 0,
    employeeDiscountRate: order.employee_discount_rate ?? 0,
    isEmployee: (order.is_employee ?? 0) === 1,
    taxRate: order.tax_rate ?? 0,
    taxAmount: order.tax_amount ?? 0,
    deliveryCharge: order.delivery_charge ?? 0,
    total: order.total ?? 0,
    restaurant: restaurantDetails,
    customer: {
      name: order.customer_name ?? '',
      phone: order.customer_phone ?? '',
      address: order.customer_address ?? '',
    },
  });

  /** The request body for the cart as it stands — what `hold`, `updateHeld` and `create` all take. */
  const cartAsOrder = (customer?: { name: string; phone: string; address: string }) => ({
    items: cart.map((c: CartItem) => ({
      id: c.id,
      name: c.name,
      price: c.price,
      quantity: c.qty,
      is_deal: c.isDeal || false,
      variant_id: c.variant_id || null,
    })),
    total,
    discount,
    payment_method: paymentMethod,
    order_type: orderType,
    delivery_charge: deliveryCharge,
    table_number: tableNumber || null,
    is_employee: isEmployee,
    customer_name: customer?.name || customerName || null,
    customer_phone: customer?.phone || customerPhone || null,
    customer_address: customer?.address || customerAddress || null,
    cashier_id: currentUser?.id || null,
    cashier_name: currentUser?.name || 'Unknown',
  });

  /**
   * Charging sends the order to the kitchen. It does not record a sale.
   *
   * The sale is recorded when the ticket is confirmed from the held-orders
   * board, which is where payment is taken. Until then it is a ticket: the
   * kitchen copy prints now, the customer and restaurant copies print on
   * confirmation, and nothing reaches a report or a shift total.
   *
   * If a held ticket was loaded for editing, this replaces it rather than
   * creating a second one — and prints the kitchen copy again, because the
   * kitchen is cooking from the old one.
   */
  const placeOrder = async (customer?: { name: string; phone: string; address: string }) => {
    setDeliveryModalOpen(false);
    try {
      const body = cartAsOrder(customer);
      const ticket = editingHold
        ? await ordersAPI.updateHeld(editingHold.id, body)
        : await ordersAPI.hold(body);

      setReceiptCopies(['kitchen']);
      setReceiptData(receiptFrom(ticket, { provisional: true }));
      setEditingHold(null);
      resetOrder();
      refreshHeldCount();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('Failed to hold order:', err);
      // The backend refuses an order with no open shift and says so with a
      // code rather than only a sentence, so this does not have to match on
      // wording that might later be reworded. See backend/routes/orders.js.
      const noShift = err instanceof ApiError && err.code === 'NO_OPEN_SHIFT';
      setSaleError({ noShift, message });
    }
  };

  /** Load a held ticket back into the cart so it can be changed. */
  const editHeld = (t: any) => {
    setCart((t.items || []).map((i: any) => ({
      id: i.id, name: i.name, price: i.price, qty: i.quantity,
      isDeal: Boolean(i.is_deal), variant_id: i.variant_id ?? null,
    })));
    setOrderType((ORDER_TYPES as readonly string[]).includes(t.order_type) ? t.order_type : 'Dine-in');
    // Whatever was charged on the ticket is what the cart shows, even if the
    // default has changed in Settings since it was held.
    setDeliveryValue(t.order_type === 'Delivery' && t.delivery_charge != null ? String(t.delivery_charge) : '');
    setTableNumber(t.table_number || '');
    setPaymentMethod(t.payment_method || 'Cash');
    setIsEmployee((t.is_employee ?? 0) === 1);
    // The manual discount comes back as a flat figure whatever it was typed as.
    setDiscountType('flat');
    setDiscountValue(t.manual_discount ? String(t.manual_discount) : '');
    setCustomerName(t.customer_name || '');
    setCustomerPhone(t.customer_phone || '');
    setCustomerAddress(t.customer_address || '');
    setEditingHold({ id: t.id, ticket_no: t.ticket_no });
    setHeldOpen(false);
  };

  /** A ticket was confirmed on the board: it is a sale now, so print the bill — the copies chosen there. */
  const heldConfirmed = (order: any, copies?: string[]) => {
    setHeldOpen(false);
    setReceiptCopies(copies && copies.length ? copies : ['customer', 'restaurant']);
    setReceiptData(receiptFrom(order, { paymentMethod: order.payment_method }));
    refreshHeldCount();
  };

  /** Any copy of a ticket, printed again while it is still held. */
  const printHeld = (t: any, copies: string[]) => {
    setReceiptCopies(copies);
    setReceiptData(receiptFrom(t, { provisional: true }));
  };

  const refreshHeldCount = () => {
    ordersAPI.held().then(rows => setHeldCount(Array.isArray(rows) ? rows.length : 0)).catch(() => {});
  };
  useEffect(() => { refreshHeldCount(); }, []);

  if (loading) {
    return (
      <div style={{ flex: 1, height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 size={32} style={{ color: 'rgba(0,0,0,0.3)' }} />
      </div>
    );
  }

  return (
    <div style={{ flex: 1, height: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <TopBar
        search={search}
        onSearchChange={setSearch}
        onNavigate={onNavigate}
        tableNumber={tableNumber}
        onTableNumberChange={setTableNumber}
        heldCount={heldCount}
        onOpenHeld={() => setHeldOpen(true)}
      />
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        <MenuPanel onAddToCart={handleAddToCart} search={search} />
        <OrderCart
          cart={cart}
          orderType={orderType}
          deliveryCharge={deliveryCharge}
          deliveryValue={deliveryValue}
          onDeliveryValueChange={setDeliveryValue}
          discountValue={discountValue}
          discountType={discountType}
          discountAmount={discount}
          taxRate={taxRate}
          taxAmount={taxAmount}
          isEmployee={isEmployee}
          employeeDiscount={employeeDiscount}
          onIsEmployeeChange={setIsEmployee}
          paymentMethod={paymentMethod}
          onDiscountValueChange={setDiscountValue}
          onDiscountTypeChange={setDiscountType}
          onPaymentMethodChange={setPaymentMethod}
          onOrderTypeChange={handleOrderTypeChange}
          onUpdateQty={handleUpdateQty}
          onRemoveItem={handleRemoveItem}
          onClearCart={handleClearCart}
          onCharge={handleCharge}
          editingTicket={editingHold?.ticket_no || null}
        />
      </div>

      {/*
        Delivery details, asked once the sale is confirmed and before the
        receipt prints. Skip is a first-class option: a regular the shop
        already knows should not hold up the queue, and a half-filled address
        is worse than none.
      */}
      <Modal
        isOpen={deliveryModalOpen}
        onClose={() => setDeliveryModalOpen(false)}
        title="Delivery Details"
        width={440}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 13, color: '#6B6B63', lineHeight: 1.5 }}>
            These print on the receipt so the rider knows where the order is going.
            Start typing a name or number to pull up a previous customer. All
            optional — skip if there is nothing to record.
          </div>

          <CustomerLookup
            value={customerName}
            onChange={setCustomerName}
            onPick={(c: Customer) => {
              setCustomerName(c.name || '');
              setCustomerPhone(c.phone || '');
              setCustomerAddress(c.address || '');
            }}
          />

          {[
            { label: 'Phone Number', value: customerPhone, set: setCustomerPhone, ph: 'e.g. 0300-1234567', type: 'tel' },
          ].map(f => (
            <div key={f.label}>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
                {f.label}
              </label>
              <input
                type={f.type}
                value={f.value}
                onChange={(e) => f.set(e.target.value)}
                placeholder={f.ph}
                style={{
                  width: '100%', height: 44, borderRadius: 8,
                  border: '1.5px solid #EBEBEB', background: '#FFFFFF',
                  padding: '0 12px', fontSize: 14, color: '#111110',
                  outline: 'none', fontFamily: 'Inter, sans-serif',
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = '#DC2626'; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = '#EBEBEB'; }}
              />
            </div>
          ))}

          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
              Delivery Address
            </label>
            <textarea
              value={customerAddress}
              onChange={(e) => setCustomerAddress(e.target.value)}
              placeholder="House / street / area"
              rows={3}
              style={{
                width: '100%', borderRadius: 8,
                border: '1.5px solid #EBEBEB', background: '#FFFFFF',
                padding: '10px 12px', fontSize: 14, color: '#111110',
                outline: 'none', fontFamily: 'Inter, sans-serif', resize: 'vertical',
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = '#DC2626'; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = '#EBEBEB'; }}
            />
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <button
              onClick={() => placeOrder()}
              style={{
                flex: 1, height: 44, borderRadius: 8,
                border: '1.5px solid #EBEBEB', background: '#FFFFFF',
                color: '#6B6B63', fontSize: 14, fontWeight: 600, cursor: 'pointer',
              }}
            >
              Skip
            </button>
            <button
              onClick={() => placeOrder({
                name: customerName.trim(),
                phone: customerPhone.trim(),
                address: customerAddress.trim(),
              })}
              style={{
                flex: 2, height: 44, borderRadius: 8, border: 'none',
                background: '#111111', color: '#FFFFFF',
                fontSize: 14, fontWeight: 600, cursor: 'pointer',
              }}
            >
              Save &amp; Print Receipt
            </button>
          </div>
        </div>
      </Modal>

      <ReceiptModal
        open={!!receiptData}
        onClose={() => { setReceiptData(null); setReceiptCopies(null); }}
        orderData={receiptData}
        copies={receiptCopies}
      />

      <HeldOrdersPanel
        open={heldOpen}
        onClose={() => setHeldOpen(false)}
        onEdit={editHeld}
        onConfirmed={heldConfirmed}
        onPrint={printHeld}
        onCountChange={setHeldCount}
      />

      <Modal
        isOpen={confirmModalOpen}
        onClose={() => setConfirmModalOpen(false)}
        title={editingHold ? `Update ticket ${editingHold.ticket_no}` : 'Send to Kitchen'}
        width={420}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/*
            Said plainly, because it is the change from before: this does not
            take the money. The kitchen copy prints now; the sale is recorded
            and the bill printed when the ticket is confirmed from Held.
          */}
          <div style={{ fontSize: 14, color: '#6B6B63', lineHeight: 1.5 }}>
            {editingHold
              ? 'The ticket is replaced and a fresh kitchen copy prints. It stays on hold until it is confirmed.'
              : 'The kitchen copy prints now. Payment is taken and the sale recorded when you confirm it from Held orders.'}
          </div>
          <div style={{ background: '#F5F5F0', borderRadius: 8, padding: 16, border: '1px solid #EBEBEB' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 13, color: '#A3A39A' }}>Items</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#111110' }}>{cart.length}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 13, color: '#A3A39A' }}>Order Type</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#111110' }}>{orderType}</span>
            </div>
            {deliveryCharge > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 13, color: '#A3A39A' }}>Delivery Charge</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#111110' }}>{formatMoney(deliveryCharge)}</span>
              </div>
            )}
            {employeeDiscount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 13, color: '#A3A39A' }}>Staff Discount ({employeeDiscountRate}%)</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#16A34A' }}>
                  − {formatMoney(employeeDiscount)}
                </span>
              </div>
            )}
            {discount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 13, color: '#A3A39A' }}>Discount</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#16A34A' }}>
                  − {formatMoney(discount)}
                  {discountType === 'percent' ? ` (${Number(discountValue) || 0}%)` : ''}
                </span>
              </div>
            )}
            {tableNumber && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 13, color: '#A3A39A' }}>Table</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#111110' }}>{tableNumber}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 13, color: '#A3A39A' }}>Payment Method</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#111110' }}>{paymentMethod}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8, borderTop: '1px solid #EBEBEB' }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#111110' }}>Total</span>
              <span style={{ fontSize: 16, fontWeight: 700, color: '#DC2626' }}>
                {formatMoney(total, { decimals: total % 1 !== 0 })}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <button
              onClick={() => setConfirmModalOpen(false)}
              style={{
                flex: 1, height: 44, borderRadius: 8,
                border: '1.5px solid #EBEBEB', background: '#FFFFFF',
                color: '#6B6B63', fontSize: 14, fontWeight: 600, cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              onClick={confirmCharge}
              style={{
                flex: 1, height: 44, borderRadius: 8, border: 'none',
                background: '#111111', color: '#FFFFFF',
                fontSize: 14, fontWeight: 600, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              <CreditCard size={18} />
              {editingHold ? 'Update ticket' : 'Send to kitchen'}
            </button>
          </div>
        </div>
      </Modal>

      {/*
        A sale that did not go through.

        The same dialog the app uses to refuse a close, for the same reason:
        these are the two moments the till says no, and they should not look
        like two different products. The no-shift case is amber and offers the
        way out; anything else is red, because it means something is actually
        wrong rather than merely not ready.
      */}
      <AlertDialog
        open={saleError !== null}
        icon={saleError?.noShift ? Clock : AlertTriangle}
        tone={saleError?.noShift ? 'warning' : 'danger'}
        title={saleError?.noShift ? 'Open a shift first' : 'That sale did not go through'}
        message={
          saleError?.noShift ? (
            <>
              Orders are recorded against a shift, so the drawer can be counted
              against them at the end of it. Nothing has been charged and the
              order is still here &mdash; open a shift and take it again.
            </>
          ) : (
            <>
              Nothing was charged and the order is still in the cart, so it can
              be taken again once this is sorted out.
            </>
          )
        }
        note={
          saleError?.noShift
            ? 'Opening a shift takes a moment: enter the cash you are starting the drawer with.'
            : undefined
        }
        confirmLabel={saleError?.noShift ? 'Open a shift' : undefined}
        confirmIcon={saleError?.noShift ? ArrowRight : undefined}
        onConfirm={saleError?.noShift ? () => { setSaleError(null); onNavigate?.('shifts'); } : undefined}
        dismissLabel={saleError?.noShift ? 'Not now' : 'Close'}
        onDismiss={() => setSaleError(null)}
      >
        {!saleError?.noShift && saleError?.message && (
          <AlertPanel label="What the till reported" tone="danger">
            <div style={{ fontSize: 13, color: '#991B1B', lineHeight: 1.5 }}>
              {saleError.message}
            </div>
          </AlertPanel>
        )}
      </AlertDialog>
    </div>
  );
}

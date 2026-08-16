import React, { useState, useEffect } from 'react';
import TopBar from '@/components/pos/TopBar';
import MenuPanel from '@/components/pos/MenuPanel';
import OrderCart from '@/components/pos/OrderCart';
import ReceiptModal from '@/components/pos/ReceiptModal';
import Modal from '@/components/pos-ui/Modal';
import { ordersAPI, settingsAPI } from '@/api/index';
import { Loader2, CreditCard } from 'lucide-react';
import { usePOS } from '@/lib/POSContext';
import { useAuth } from '@/context/AuthContext';
import moment from 'moment';
import { PAYMENT_METHODS, type PaymentMethod } from '@/lib/constants';

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
  };
  items: { name: string; quantity: number; price: number }[];
  subtotal: number;
  discount: number;
  deliveryCharge: number;
  total: number;
  restaurant: RestaurantDetails;
}

interface SaleScreenProps {
  onNavigate?: (page: string) => void;
}

export default function SaleScreen({ onNavigate }: SaleScreenProps = {}) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState('');
  const [orderType, setOrderType] = useState<'Dine-in' | 'Delivery'>('Dine-in');
  const [deliveryPrice, setDeliveryPrice] = useState(0);
  /**
   * FIX (Bug 6): discount, payment method and table number were hardcoded to
   * 0 / 'Cash' / '—' at checkout even though the database, the reports and
   * the receipt template all supported them. They are real inputs now.
   */
  const [discountValue, setDiscountValue] = useState('');
  const [discountType, setDiscountType] = useState<'flat' | 'percent'>('flat');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('Cash');
  const [tableNumber, setTableNumber] = useState('');
  const [restaurantDetails, setRestaurantDetails] = useState<RestaurantDetails>({
    name: '',
    tagline: '',
    address: '',
    phone: '',
    footerMessage: 'Thank you for visiting!',
  });
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const { loading } = usePOS();
  const { currentUser } = useAuth();

  useEffect(() => {
    const loadSettings = () => {
      settingsAPI.getAll().then((data) => {
        setDeliveryPrice(Number(data.delivery_price) || 0);
        setRestaurantDetails({
          name: data.restaurant_name || '',
          tagline: data.restaurant_tagline || '',
          address: data.restaurant_address || '',
          phone: data.restaurant_phone || '',
          footerMessage: data.receipt_footer || 'Thank you for visiting!',
        });
      }).catch(() => {});
    };
    loadSettings();
    window.addEventListener('focus', loadSettings);
    return () => window.removeEventListener('focus', loadSettings);
  }, []);

  const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const deliveryCharge = orderType === 'Delivery' ? deliveryPrice : 0;

  // Percent discounts are computed off the subtotal, and any discount is
  // capped so an order can never go negative. Delivery is added afterwards
  // so a discount never eats into the rider's fee.
  const rawDiscount = discountType === 'percent'
    ? (subtotal * (Number(discountValue) || 0)) / 100
    : (Number(discountValue) || 0);
  const discount = Math.min(Math.max(0, Math.round(rawDiscount)), subtotal);
  const total = Math.max(0, subtotal - discount) + deliveryCharge;

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
    setDiscountValue('');
    setDiscountType('flat');
    setPaymentMethod('Cash');
    setTableNumber('');
  };

  const handleClearCart = () => resetOrder();

  const handleOrderTypeChange = (type: 'Dine-in' | 'Delivery') => {
    setOrderType(type);
    if (type === 'Delivery') {
      settingsAPI.getAll().then((data) => {
        setDeliveryPrice(Number(data.delivery_price) || 0);
      }).catch((err) => {
        console.error('Failed to load delivery price from settings:', err);
      });
    }
  };

  const handleCharge = () => setConfirmModalOpen(true);

  const confirmCharge = async () => {
    setConfirmModalOpen(false);
    try {
      const items = cart.map((c: CartItem) => ({
        id: c.id,
        name: c.name,
        price: c.price,
        quantity: c.qty,
        is_deal: c.isDeal || false,
        variant_id: c.variant_id || null,
      }));

      const order = await ordersAPI.create({
        items,
        total,
        discount,
        payment_method: paymentMethod,
        order_type: orderType,
        delivery_charge: deliveryCharge,
        table_number: tableNumber || null,
        cashier_id: currentUser?.id || null,
        cashier_name: currentUser?.name || 'Unknown',
      });

      setReceiptData({
        orderInfo: {
          date: moment().format('DD/MM/YYYY'),
          time: moment().format('HH:mm A'),
          orderNumber: order.id ? `#${order.id}` : `#${Math.floor(1000 + Math.random() * 9000)}`,
          table: tableNumber || '—',
          paymentMethod,
          cashier: currentUser?.name || 'Unknown',
          orderType,
        },
        items: cart.map((c: CartItem) => ({
          name: c.name,
          quantity: c.qty,
          price: c.price,
        })),
        subtotal,
        discount,
        deliveryCharge,
        total,
        restaurant: restaurantDetails,
      });

      resetOrder();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('Failed to charge order:', err);
      alert('Failed to complete sale: ' + message);
    }
  };

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
      />
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        <MenuPanel onAddToCart={handleAddToCart} search={search} />
        <OrderCart
          cart={cart}
          orderType={orderType}
          deliveryCharge={deliveryPrice}
          discountValue={discountValue}
          discountType={discountType}
          discountAmount={discount}
          paymentMethod={paymentMethod}
          onDiscountValueChange={setDiscountValue}
          onDiscountTypeChange={setDiscountType}
          onPaymentMethodChange={setPaymentMethod}
          onOrderTypeChange={handleOrderTypeChange}
          onUpdateQty={handleUpdateQty}
          onRemoveItem={handleRemoveItem}
          onClearCart={handleClearCart}
          onCharge={handleCharge}
        />
      </div>

      <ReceiptModal
        open={!!receiptData}
        onClose={() => setReceiptData(null)}
        orderData={receiptData}
      />

      <Modal
        isOpen={confirmModalOpen}
        onClose={() => setConfirmModalOpen(false)}
        title="Confirm Sale"
        width={420}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ fontSize: 14, color: '#6B6B63', lineHeight: 1.5 }}>
            Are you sure you want to complete this sale?
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
                <span style={{ fontSize: 13, fontWeight: 600, color: '#111110' }}>Rs. {deliveryCharge.toLocaleString()}</span>
              </div>
            )}
            {discount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 13, color: '#A3A39A' }}>Discount</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#16A34A' }}>
                  − Rs. {discount.toLocaleString()}
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
                Rs. {total.toLocaleString()}
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
              Confirm Sale
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

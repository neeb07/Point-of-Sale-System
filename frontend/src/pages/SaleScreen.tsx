import React, { useState } from 'react';
import TopBar from '@/components/pos/TopBar';
import MenuPanel from '@/components/pos/MenuPanel';
import OrderCart from '@/components/pos/OrderCart';
import ReceiptModal from '@/components/pos/ReceiptModal';
import Modal from '@/components/pos-ui/Modal';
import { ordersAPI } from '@/api/index';
import { Loader2, CreditCard } from 'lucide-react';
import { usePOS } from '@/lib/POSContext';
import { useAuth } from '@/context/AuthContext';
import moment from 'moment';

interface CartItem {
  id: number;
  name: string;
  price: number;
  qty: number;
}

interface ReceiptData {
  orderInfo: {
    date: string;
    time: string;
    orderNumber: string;
    table: string;
    paymentMethod: string;
    cashier: string;
  };
  items: { name: string; quantity: number; price: number }[];
  subtotal: number;
  discount: number;
  total: number;
}

export default function SaleScreen() {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState('');
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const { loading } = usePOS();
  const { currentUser } = useAuth();

  const handleAddToCart = (item: CartItem) => {
    setCart((prev: CartItem[]) => {
      const existing = prev.find((c: CartItem) => c.id === item.id && c.name === item.name);
      if (existing) {
        return prev.map((c: CartItem) =>
          (c.id === item.id && c.name === item.name) ? { ...c, qty: c.qty + 1 } : c
        );
      }
      return [...prev, { id: item.id, name: item.name, price: item.price, qty: 1 }];
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

  const handleClearCart = () => setCart([]);

  const handleCharge = () => setConfirmModalOpen(true);

  const confirmCharge = async () => {
    setConfirmModalOpen(false);
    try {
      const total = cart.reduce(
        (sum: number, item: CartItem) => sum + item.price * item.qty,
        0
      );
      const items = cart.map((c: CartItem) => ({
        id: c.id,
        name: c.name,
        price: c.price,
        quantity: c.qty,
      }));

      const order = await ordersAPI.create({
        items,
        total,
        discount: 0,
        payment_method: 'Cash',
        cashier_id: currentUser?.id || null,
        cashier_name: currentUser?.name || 'Unknown',
      });

      setReceiptData({
        orderInfo: {
          date: moment().format('DD/MM/YYYY'),
          time: moment().format('HH:mm A'),
          orderNumber: order.id ? `#${order.id}` : `#${Math.floor(1000 + Math.random() * 9000)}`,
          table: '—',
          paymentMethod: 'Cash',
          cashier: currentUser?.name || 'Unknown',
        },
        items: cart.map((c: CartItem) => ({
          name: c.name,
          quantity: c.qty,
          price: c.price,
        })),
        subtotal: total,
        discount: 0,
        total,
      });

      setCart([]);
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
      <TopBar search={search} onSearchChange={setSearch} />
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        <MenuPanel onAddToCart={handleAddToCart} search={search} />
        <OrderCart
          cart={cart}
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
              <span style={{ fontSize: 13, color: '#A3A39A' }}>Payment Method</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#111110' }}>Cash</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8, borderTop: '1px solid #EBEBEB' }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#111110' }}>Total</span>
              <span style={{ fontSize: 16, fontWeight: 700, color: '#F97316' }}>
                Rs. {cart.reduce((sum: number, item: CartItem) => sum + item.price * item.qty, 0).toLocaleString()}
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
                background: '#F97316', color: '#FFFFFF',
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

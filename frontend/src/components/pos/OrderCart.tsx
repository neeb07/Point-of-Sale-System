import React from 'react';
import { Trash2, Plus, Minus, CreditCard } from 'lucide-react';

interface CartItem {
  id: number;
  name: string;
  price: number;
  qty: number;
}

interface OrderCartProps {
  cart: CartItem[];
  onUpdateQty: (id: number, delta: number) => void;
  onRemoveItem: (id: number) => void;
  onClearCart: () => void;
  onCharge: () => void;
}

export default function OrderCart({ cart, onUpdateQty, onRemoveItem, onClearCart, onCharge }: OrderCartProps) {
  const total = cart.reduce((sum: number, item: CartItem) => sum + (item.price * item.qty), 0);

  return (
    <div
      style={{
        width: 360,
        height: '100%',
        background: '#FFFFFF',
        borderLeft: '1px solid #EBEBEB',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
      }}
    >
      {/* Header */}
      <div style={{ padding: '16px 18px', borderBottom: '1px solid #EBEBEB' }}>
        <h2 style={{ fontSize: 17, fontWeight: 700, color: '#111110', margin: 0, letterSpacing: '-0.3px' }}>
          Current Order
        </h2>
        <div style={{ fontSize: 12, color: '#A3A39A', marginTop: 3 }}>
          {cart.length} {cart.length === 1 ? 'item' : 'items'}
        </div>
      </div>

      {/* Items */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 18px' }}>
        {cart.length === 0 ? (
          <div style={{
            height: '100%', display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', textAlign: 'center',
          }}>
            <div style={{ fontSize: 44, marginBottom: 12 }}>🛒</div>
            <p style={{ fontSize: 14, fontWeight: 600, color: '#6B6B63', margin: '0 0 4px' }}>Cart is empty</p>
            <p style={{ fontSize: 13, color: '#BCBCB4', margin: 0 }}>Add items from the menu</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {cart.map((item: CartItem, idx: number) => (
              <div
                key={item.id}
                style={{
                  paddingBottom: 14, marginBottom: 14,
                  borderBottom: idx < cart.length - 1 ? '1px solid #F0F0EB' : 'none',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#111110', paddingRight: 8, lineHeight: 1.4 }}>
                    {item.name}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#111110', flexShrink: 0 }}>
                    Rs. {(item.price * item.qty).toLocaleString()}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ fontSize: 12, color: '#A3A39A' }}>Rs. {item.price.toLocaleString()} each</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button
                      onClick={() => onUpdateQty(item.id, -1)}
                      style={{
                        width: 26, height: 26, borderRadius: '50%',
                        background: '#F5F5F0', color: '#6B6B63',
                        border: '1.5px solid #EBEBEB', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      <Minus size={12} />
                    </button>
                    <span style={{ fontSize: 13, fontWeight: 700, width: 18, textAlign: 'center', color: '#111110' }}>
                      {item.qty}
                    </span>
                    <button
                      onClick={() => onUpdateQty(item.id, 1)}
                      style={{
                        width: 26, height: 26, borderRadius: '50%',
                        background: '#FFF7ED', color: '#F97316',
                        border: '1.5px solid rgba(249,115,22,0.30)', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      <Plus size={12} />
                    </button>
                    <button
                      onClick={() => onRemoveItem(item.id)}
                      style={{
                        width: 26, height: 26, borderRadius: '50%',
                        background: 'transparent', color: '#BCBCB4',
                        border: 'none', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        marginLeft: 2,
                        transition: 'color 120ms',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.color = '#EF4444'; }}
                      onMouseLeave={e => { e.currentTarget.style.color = '#BCBCB4'; }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: '16px 18px', background: '#FAFAF8', borderTop: '1px solid #EBEBEB' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 13, color: '#A3A39A' }}>Subtotal</span>
          <span style={{ fontSize: 13, fontWeight: 500, color: '#111110' }}>Rs. {total.toLocaleString()}</span>
        </div>
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          marginBottom: 14, paddingBottom: 14,
          borderBottom: '1px solid #EBEBEB',
        }}>
          <span style={{ fontSize: 13, color: '#A3A39A' }}>Discount</span>
          <span style={{ fontSize: 13, fontWeight: 500, color: '#10B981' }}>- Rs. 0</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: '#111110' }}>Total</span>
          <span style={{ fontSize: 16, fontWeight: 700, color: '#F97316' }}>Rs. {total.toLocaleString()}</span>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={onClearCart}
            disabled={cart.length === 0}
            style={{
              flex: 1, height: 44, borderRadius: 10,
              border: '1.5px solid #EBEBEB',
              background: '#FFFFFF', color: cart.length === 0 ? '#BCBCB4' : '#EF4444',
              fontSize: 14, fontWeight: 600,
              cursor: cart.length === 0 ? 'not-allowed' : 'pointer',
              opacity: cart.length === 0 ? 0.5 : 1,
              transition: 'all 140ms',
            }}
            onMouseEnter={e => { if (cart.length > 0) e.currentTarget.style.background = '#FEF2F2'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#FFFFFF'; }}
          >
            Clear
          </button>
          <button
            onClick={onCharge}
            disabled={cart.length === 0}
            style={{
              flex: 2, height: 44, borderRadius: 10, border: 'none',
              background: cart.length === 0 ? '#EBEBEB' : '#F97316',
              color: cart.length === 0 ? '#BCBCB4' : '#FFFFFF',
              fontSize: 14, fontWeight: 600,
              cursor: cart.length === 0 ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              boxShadow: cart.length > 0 ? '0 2px 8px rgba(249,115,22,0.28)' : 'none',
              transition: 'all 140ms',
            }}
            onMouseEnter={e => { if (cart.length > 0) e.currentTarget.style.background = '#EA6C0A'; }}
            onMouseLeave={e => { if (cart.length > 0) e.currentTarget.style.background = '#F97316'; }}
          >
            <CreditCard size={17} />
            Charge Order
          </button>
        </div>
      </div>
    </div>
  );
}

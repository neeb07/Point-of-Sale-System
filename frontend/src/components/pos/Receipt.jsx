import React from 'react';

const RestaurantDetails = {
  name: 'Al-Madina Fast Food',
  address: '123 Main Street, Food Avenue',
  phone: '0300-1234567',
};

const ReceiptHeader = () => (
  <div
    style={{
      background: 'linear-gradient(135deg, #F97316, #EA580C)',
      color: '#FFFFFF',
      padding: '24px 20px',
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      textAlign: 'center',
    }}
  >
    <div
      style={{
        width: 48,
        height: 48,
        borderRadius: 24,
        background: '#FFFFFF',
        color: '#EA580C',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 800,
        fontSize: 24,
        marginBottom: 12,
      }}
    >
      {RestaurantDetails.name.charAt(0)}
    </div>
    <div style={{ fontWeight: 700, fontSize: 18, fontFamily: 'Inter, sans-serif', marginBottom: 4 }}>
      {RestaurantDetails.name}
    </div>
    <div style={{ fontSize: 12, opacity: 0.9 }}>
      {RestaurantDetails.address} &middot; {RestaurantDetails.phone}
    </div>
  </div>
);

const ReceiptMeta = ({ orderInfo }) => (
  <div style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#6B7280' }}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div>Date: {orderInfo.date}</div>
      <div>Time: {orderInfo.time}</div>
      <div>Order #: {orderInfo.orderNumber}</div>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, textAlign: 'right' }}>
      <div>Cashier: {orderInfo.cashier}</div>
      <div>Table: {orderInfo.table || '—'}</div>
      <div>Payment: {orderInfo.paymentMethod}</div>
    </div>
  </div>
);

const ReceiptDivider = ({ dashed = true }) => (
  <div
    style={{
      borderTop: dashed ? '2px dashed #E5E7EB' : '1px solid #E5E7EB',
      margin: '0 20px',
    }}
  />
);

const ReceiptItemsTable = ({ items }) => (
  <div style={{ padding: '16px 20px' }}>
    <div style={{ display: 'flex', fontSize: 11, color: '#9CA3AF', textTransform: 'uppercase', fontWeight: 600, marginBottom: 12 }}>
      <div style={{ flex: 1 }}>Item</div>
      <div style={{ width: 60, textAlign: 'center' }}>Qty</div>
      <div style={{ width: 80, textAlign: 'right' }}>Amount</div>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {items.map((item, idx) => (
        <div key={idx} style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ flex: 1, fontWeight: 500, fontSize: 13, color: '#374151' }}>
            {item.name}
          </div>
          <div style={{ width: 60, textAlign: 'center', fontSize: 13, color: '#6B7280' }}>
            x{item.quantity}
          </div>
          <div style={{ width: 80, textAlign: 'right', fontWeight: 700, fontSize: 13, color: '#111827' }}>
            Rs.{item.price * item.quantity}
          </div>
        </div>
      ))}
    </div>
  </div>
);

const ReceiptTotals = ({ subtotal, discount, total }) => (
  <div style={{ display: 'flex', flexDirection: 'column' }}>
    <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13, color: '#374151', fontWeight: 500 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>Subtotal</span>
        <span>Rs.{subtotal}</span>
      </div>
      {discount > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#EF4444' }}>
          <span>Discount</span>
          <span>-Rs.{discount}</span>
        </div>
      )}
    </div>
    <ReceiptDivider dashed={false} />
    <div
      style={{
        background: '#FFF7ED',
        padding: '16px 20px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}
    >
      <span style={{ fontWeight: 800, fontSize: 15, color: '#111827' }}>TOTAL</span>
      <span style={{ fontWeight: 800, fontSize: 20, color: '#F97316' }}>Rs.{total}</span>
    </div>
  </div>
);

const ReceiptFooter = () => (
  <div
    style={{
      background: '#F9FAFB',
      padding: '24px 20px',
      borderBottomLeftRadius: 16,
      borderBottomRightRadius: 16,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      textAlign: 'center',
      gap: 6,
    }}
  >
    <div style={{ fontWeight: 600, fontSize: 14, color: '#4B5563' }}>Thank you for visiting!</div>
    <div style={{ fontSize: 12, color: '#9CA3AF' }}>{RestaurantDetails.name}</div>
    <div style={{ color: '#F97316', fontSize: 16, marginTop: 4, letterSpacing: 4 }}>
      ★ ★ ★ ★ ★
    </div>
  </div>
);

export default function Receipt({ orderInfo, items, subtotal, discount, total }) {
  return (
    <div
      style={{
        width: 340,
        background: '#FFFFFF',
        borderRadius: 16,
        boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
        border: '1px solid #E5E7EB',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'Inter, sans-serif',
        margin: '0 auto',
      }}
    >
      <ReceiptHeader />
      <ReceiptMeta orderInfo={orderInfo} />
      <ReceiptDivider />
      <ReceiptItemsTable items={items} />
      <ReceiptDivider />
      <ReceiptTotals subtotal={subtotal} discount={discount} total={total} />
      <ReceiptFooter />
    </div>
  );
}

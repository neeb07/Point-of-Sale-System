import React from 'react';

const ReceiptHeader = ({ restaurant }) => (
  <div
    style={{
      background: 'linear-gradient(135deg, #DC2626, #B91C1C)',
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
        color: '#DC2626',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 800,
        fontSize: 24,
        marginBottom: 12,
      }}
    >
      {(restaurant?.name || 'R').charAt(0)}
    </div>
    <div style={{ fontWeight: 700, fontSize: 18, fontFamily: 'Inter, sans-serif', marginBottom: 4 }}>
      {restaurant?.name || 'Restaurant'}
    </div>
    {restaurant?.tagline && (
      <div style={{ fontSize: 12, opacity: 0.9, marginBottom: 4, fontStyle: 'italic' }}>
        {restaurant.tagline}
      </div>
    )}
    {(restaurant?.address || restaurant?.phone) && (
      <div style={{ fontSize: 12, opacity: 0.9 }}>
        {[restaurant?.address, restaurant?.phone].filter(Boolean).join(' · ')}
      </div>
    )}
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
      {orderInfo.orderType && <div>Type: {orderInfo.orderType}</div>}
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

const ReceiptTotals = ({ subtotal, discount, deliveryCharge, total, orderType }) => (
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
      {(deliveryCharge > 0 || orderType === 'Delivery') && (
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Delivery Charge</span>
          <span>Rs.{deliveryCharge}</span>
        </div>
      )}
    </div>
    <ReceiptDivider dashed={false} />
    <div
      style={{
        background: '#FEEFD0',
        padding: '16px 20px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}
    >
      <span style={{ fontWeight: 800, fontSize: 15, color: '#111827' }}>TOTAL</span>
      <span style={{ fontWeight: 800, fontSize: 20, color: '#DC2626' }}>Rs.{total}</span>
    </div>
  </div>
);

const ReceiptFooter = ({ restaurant }) => (
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
    <div style={{ fontWeight: 600, fontSize: 14, color: '#4B5563' }}>
      {restaurant?.footerMessage || 'Thank you for visiting!'}
    </div>
    {restaurant?.name && (
      <div style={{ fontSize: 12, color: '#9CA3AF' }}>{restaurant.name}</div>
    )}
    <div style={{ color: '#DC2626', fontSize: 16, marginTop: 4, letterSpacing: 4 }}>
      ★ ★ ★ ★ ★
    </div>
  </div>
);

/**
 * Which of the three printed copies this is. All three carry identical
 * figures — only the banner differs — so the stack can be separated after
 * printing: one to the kitchen, one to the customer, one for the till.
 */
export const COPY_TYPES = ['kitchen', 'customer', 'restaurant'];

const COPY_LABELS = {
  kitchen: 'KITCHEN COPY',
  customer: 'CUSTOMER COPY',
  restaurant: 'RESTAURANT COPY',
};

const CopyBanner = ({ copyType }) => {
  if (!copyType || !COPY_LABELS[copyType]) return null;
  return (
    <div
      style={{
        background: '#111111',
        color: '#FFFFFF',
        textAlign: 'center',
        padding: '6px 0',
        fontSize: 13,
        fontWeight: 800,
        letterSpacing: 2,
        fontFamily: 'Inter, sans-serif',
      }}
    >
      {COPY_LABELS[copyType]}
    </div>
  );
};

export default function Receipt({
  orderInfo,
  items,
  subtotal,
  discount,
  deliveryCharge,
  total,
  restaurant,
  copyType,
}) {
  return (
    <div
      className="receipt-copy"
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
        overflow: 'hidden',
      }}
    >
      <CopyBanner copyType={copyType} />
      <ReceiptHeader restaurant={restaurant} />
      <ReceiptMeta orderInfo={orderInfo} />
      <ReceiptDivider />
      <ReceiptItemsTable items={items} />
      <ReceiptDivider />
      <ReceiptTotals subtotal={subtotal} discount={discount} deliveryCharge={deliveryCharge || 0} total={total} orderType={orderInfo?.orderType} />
      <ReceiptFooter restaurant={restaurant} />
    </div>
  );
}

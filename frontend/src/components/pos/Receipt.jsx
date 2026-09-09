import React from 'react';
import { useSettings } from '@/lib/SettingsContext';

/**
 * The top of the receipt.
 *
 * This was a red gradient block with white text and a white circle holding the
 * shop's initial. It printed as nothing at all: browsers drop background
 * colours when printing unless a page asks otherwise, and no rule here does, so
 * the background vanished and the white text was left on white paper. Every
 * receipt came off the roll with a blank space where the shop's name, address
 * and telephone number should be — which is exactly the "empty space at the
 * top" this was reported as.
 *
 * The fix is not to force the colour through. A thermal printer has one ink and
 * makes a solid black block of it, which is slow, drains the head, and looks
 * nothing like a receipt. Dark text on bare paper is what a receipt is.
 *
 * The circle went with it. It cost sixty vertical millimetres of roll to print
 * one letter that the shop's name says underneath anyway.
 */
const ReceiptHeader = ({ restaurant }) => (
  <div
    style={{
      padding: '12px 20px 8px',
      color: '#111827',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      textAlign: 'center',
    }}
  >
    <div style={{ fontWeight: 800, fontSize: 20, fontFamily: 'Inter, sans-serif', letterSpacing: 0.5 }}>
      {restaurant?.name || 'Restaurant'}
    </div>
    {restaurant?.tagline && (
      <div style={{ fontSize: 11, marginTop: 2, fontStyle: 'italic', color: '#4B5563' }}>
        {restaurant.tagline}
      </div>
    )}
    {restaurant?.address && (
      <div style={{ fontSize: 11, marginTop: 4, color: '#374151', lineHeight: 1.35 }}>
        {restaurant.address}
      </div>
    )}
    {restaurant?.phone && (
      <div style={{ fontSize: 11, marginTop: 2, color: '#374151' }}>
        {restaurant.phone}
      </div>
    )}
  </div>
);

const ReceiptMeta = ({ orderInfo }) => {
  // Settings offered toggles for these rows but nothing consulted them.
  const { showCashier, showOrderNumber, showPayment } = useSettings();
  return (
  <div style={{ padding: '8px 20px', display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#374151' }}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div>Date: {orderInfo.date}</div>
      <div>Time: {orderInfo.time}</div>
      {showOrderNumber && <div>Order #: {orderInfo.orderNumber}</div>}
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, textAlign: 'right' }}>
      {showCashier && <div>Cashier: {orderInfo.cashier}</div>}
      <div>Table: {orderInfo.table || '—'}</div>
      {showPayment && <div>Payment: {orderInfo.paymentMethod}</div>}
      {orderInfo.orderType && <div>Type: {orderInfo.orderType}</div>}
    </div>
  </div>
  );
};

/**
 * Where the order is going. Printed on every copy of a delivery order — the
 * kitchen bags it, the rider drives it, the till keeps the record — and hidden
 * entirely when the cashier skipped the prompt or the order is dine-in.
 */
const ReceiptCustomer = ({ customer }) => {
  const has = customer && (customer.name || customer.phone || customer.address);
  if (!has) return null;
  return (
    <div style={{ padding: '8px 20px', fontSize: 11, color: '#374151' }}>
      <div style={{
        fontSize: 10, color: '#4B5563', textTransform: 'uppercase',
        fontWeight: 700, marginBottom: 4, letterSpacing: 0.5,
      }}>
        Deliver To
      </div>
      {customer.name && <div style={{ fontWeight: 700, fontSize: 13 }}>{customer.name}</div>}
      {customer.phone && <div style={{ marginTop: 2 }}>{customer.phone}</div>}
      {customer.address && (
        <div style={{ marginTop: 2, lineHeight: 1.35 }}>{customer.address}</div>
      )}
    </div>
  );
};

const ReceiptDivider = ({ dashed = true }) => (
  <div
    style={{
      // Was #E5E7EB, which is very nearly white and printed as nothing at
      // all — the receipt came out as one undivided column of text.
      borderTop: dashed ? '1px dashed #9CA3AF' : '1px solid #9CA3AF',
      margin: '0 20px',
    }}
  />
);

/**
 * `showPrices` is false on the kitchen copy.
 *
 * The kitchen needs to know what to cook and how many; money is not their
 * concern, and printing it on the ticket that goes back into the kitchen is a
 * quiet way of showing every customer's bill to everyone working there.
 */
const ReceiptItemsTable = ({ items, showPrices = true }) => {
  const { formatMoney } = useSettings();
  return (
  <div style={{ padding: '10px 20px' }}>
    <div style={{ display: 'flex', fontSize: 10, color: '#4B5563', textTransform: 'uppercase', fontWeight: 700, marginBottom: 6, borderBottom: '1px solid #D1D5DB', paddingBottom: 4 }}>
      <div style={{ flex: 1 }}>Item</div>
      <div style={{ width: 60, textAlign: showPrices ? 'center' : 'right' }}>Qty</div>
      {showPrices && <div style={{ width: 80, textAlign: 'right' }}>Amount</div>}
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map((item, idx) => (
        <div key={idx} style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ flex: 1, fontWeight: 500, fontSize: 13, color: '#374151' }}>
            {item.name}
          </div>
          <div style={{
            width: 60,
            textAlign: showPrices ? 'center' : 'right',
            fontSize: showPrices ? 13 : 15,
            fontWeight: showPrices ? 400 : 700,
            color: showPrices ? '#6B7280' : '#111827',
          }}>
            x{item.quantity}
          </div>
          {showPrices && (
            <div style={{ width: 80, textAlign: 'right', fontWeight: 700, fontSize: 13, color: '#111827' }}>
              {formatMoney(item.price * item.quantity)}
            </div>
          )}
        </div>
      ))}
    </div>
  </div>
  );
};

const ReceiptTotals = ({ subtotal, discount, employeeDiscount, employeeDiscountRate, taxRate, taxAmount, deliveryCharge, total, orderType }) => {
  const { formatMoney, showTax } = useSettings();

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '8px 20px', display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, color: '#374151', fontWeight: 500 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Subtotal</span>
          <span>{formatMoney(subtotal)}</span>
        </div>
        {discount > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#EF4444' }}>
            <span>Discount</span>
            <span>-{formatMoney(discount)}</span>
          </div>
        )}
        {/* Staff purchases carry their own discount line so the customer copy
            and the till copy both show why the price differs from the menu. */}
        {employeeDiscount > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#16A34A' }}>
            <span>Staff Discount{employeeDiscountRate ? ` (${employeeDiscountRate}%)` : ''}</span>
            <span>-{formatMoney(employeeDiscount)}</span>
          </div>
        )}
        {/* The tax rate is set in Settings but never reached the receipt, so a
            shop charging tax had no way to show it to the customer. */}
        {showTax && taxAmount > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Tax{taxRate ? ` (${taxRate}%)` : ''}</span>
            <span>{formatMoney(taxAmount, { decimals: taxAmount % 1 !== 0 })}</span>
          </div>
        )}
        {(deliveryCharge > 0 || orderType === 'Delivery') && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Delivery Charge</span>
            <span>{formatMoney(deliveryCharge)}</span>
          </div>
        )}
      </div>
      <ReceiptDivider dashed={false} />
      <div
        style={{
          /*
            Bordered rather than filled. The peach background behind this row
            is dropped when printing, which left the one line the customer
            actually checks looking like every other line on the paper. Rules
            above and below survive the print head; a fill does not.
          */
          borderTop: '2px solid #111827',
          borderBottom: '2px solid #111827',
          padding: '8px 20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span style={{ fontWeight: 800, fontSize: 15, color: '#111827' }}>TOTAL</span>
        <span style={{ fontWeight: 800, fontSize: 20, color: '#DC2626' }}>
          {formatMoney(total, { decimals: total % 1 !== 0 })}
        </span>
      </div>
    </div>
  );
};

/**
 * Printed at the bottom of every receipt, and not configurable.
 *
 * Kept as a constant in the component that prints it rather than as a setting:
 * a value the shop cannot change should not live in the table the shop edits,
 * where it would look editable and could be blanked by accident.
 */
const SOFTWARE_BY = {
  label: 'POS Software By:',
  company: 'Virtiqo (Private) Limited',
  phone: '+92 300 8536046',
  email: 'info@virtiqo.com',
};

/**
 * The maker's line, in the shape these receipts take locally.
 *
 * Left-aligned under a rule rather than centred with the thank-you message
 * above it — the two are different kinds of thing, and running them together
 * reads as though the shop is thanking you on behalf of a software company.
 *
 * Printed in black, not the grey used elsewhere on screen. A thermal printer
 * has no greys: it either burns a dot or it does not, so light text comes out
 * broken up or missing entirely. Anything that must survive the print head is
 * full black.
 */
const SoftwareBy = () => (
  <div
    style={{
      borderTop: '1px solid #9CA3AF',
      marginTop: 10,
      paddingTop: 8,
      // The footer is a centring flex column, so a child has to say explicitly
      // that it wants the full width — otherwise it shrinks to its text and the
      // left alignment has nothing to align against.
      width: '100%',
      alignSelf: 'stretch',
      textAlign: 'left',
      fontSize: 11,
      lineHeight: 1.45,
      color: '#111827',
    }}
  >
    <div style={{ fontWeight: 700 }}>{SOFTWARE_BY.label}</div>
    <div style={{ fontWeight: 700 }}>
      {SOFTWARE_BY.company} {SOFTWARE_BY.phone}
    </div>
    <div style={{ fontWeight: 700 }}>{SOFTWARE_BY.email}</div>
  </div>
);

/**
 * The bottom.
 *
 * The stars are gone, and so is the second printing of the shop's name — it is
 * already at the top of the same piece of paper. Both cost roll, and a till
 * roll is a consumable the shop buys.
 */
const ReceiptFooter = ({ restaurant }) => (
  <div
    style={{
      padding: '10px 20px 12px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      textAlign: 'center',
      gap: 4,
    }}
  >
    <div style={{ fontWeight: 600, fontSize: 12, color: '#374151' }}>
      {restaurant?.footerMessage || 'Thank you for visiting!'}
    </div>
    {/*
      On every receipt this software prints. The message above it is the shop's
      own and is theirs to write; this one is not, and there is nothing to
      configure — so there is no configuration.
    */}
    <SoftwareBy />
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
        // Was white on near-black, which printed as a blank strip for the same
        // reason the header did. The whole point of this line is to tell the
        // kitchen copy from the customer's after they come off the roll, so it
        // is the last thing that should be invisible on paper.
        color: '#111111',
        borderBottom: '1px solid #111111',
        textAlign: 'center',
        padding: '5px 0',
        fontSize: 12,
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
  employeeDiscount,
  employeeDiscountRate,
  taxRate,
  taxAmount,
  deliveryCharge,
  total,
  restaurant,
  copyType,
  customer,
}) {
  // The kitchen ticket carries what to cook, not what it costs.
  const showPrices = copyType !== 'kitchen';

  // Settings offers a paper size but nothing applied it, so an 80mm roll and a
  // 58mm roll both received the same fixed 340px layout.
  const { paperSize } = useSettings();
  const width = paperSize === '58mm' ? 260 : 340;

  return (
    <div
      className="receipt-copy"
      style={{
        width,
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
      <ReceiptCustomer customer={customer} />
      <ReceiptDivider />
      <ReceiptItemsTable items={items} showPrices={showPrices} />
      <ReceiptDivider />
      {showPrices && (
        <ReceiptTotals
          subtotal={subtotal}
          discount={discount}
          employeeDiscount={employeeDiscount || 0}
          employeeDiscountRate={employeeDiscountRate || 0}
          taxRate={taxRate || 0}
          taxAmount={taxAmount || 0}
          deliveryCharge={deliveryCharge || 0}
          total={total}
          orderType={orderInfo?.orderType}
        />
      )}
      <ReceiptFooter restaurant={restaurant} />
    </div>
  );
}

import React from 'react';
import { Trash2, Plus, Minus, CreditCard, Banknote, Globe } from 'lucide-react';
import { PAYMENT_METHODS, type PaymentMethod } from '@/lib/constants';
import { useSettings } from '@/lib/SettingsContext';

interface CartItem {
  id: number;
  name: string;
  price: number;
  qty: number;
}

interface OrderCartProps {
  cart: CartItem[];
  orderType: 'Dine-in' | 'Delivery';
  deliveryCharge: number;
  /** FIX (Bug 6): discount and payment method are real inputs now. */
  discountValue: string;
  discountType: 'flat' | 'percent';
  discountAmount: number;
  /** Tax computed from the shop's configured rate; 0 when tax is disabled. */
  taxRate: number;
  taxAmount: number;
  /** Staff purchase: applies the configured staff discount automatically. */
  isEmployee: boolean;
  employeeDiscount: number;
  onIsEmployeeChange: (value: boolean) => void;
  paymentMethod: PaymentMethod;
  onDiscountValueChange: (value: string) => void;
  onDiscountTypeChange: (type: 'flat' | 'percent') => void;
  onPaymentMethodChange: (method: PaymentMethod) => void;
  onOrderTypeChange: (type: 'Dine-in' | 'Delivery') => void;
  onUpdateQty: (id: number, name: string, delta: number) => void;
  onRemoveItem: (id: number, name: string) => void;
  onClearCart: () => void;
  onCharge: () => void;
}

const PAYMENT_ICONS: Record<PaymentMethod, React.ElementType> = {
  Cash: Banknote,
  Card: CreditCard,
  Online: Globe,
};

export default function OrderCart({
  cart,
  orderType,
  deliveryCharge,
  discountValue,
  discountType,
  discountAmount,
  taxRate,
  taxAmount,
  isEmployee,
  employeeDiscount,
  onIsEmployeeChange,
  paymentMethod,
  onDiscountValueChange,
  onDiscountTypeChange,
  onPaymentMethodChange,
  onOrderTypeChange,
  onUpdateQty,
  onRemoveItem,
  onClearCart,
  onCharge,
}: OrderCartProps) {
  const { formatMoney, currencySymbol, employeeDiscountRate } = useSettings();
  const subtotal = cart.reduce((sum: number, item: CartItem) => sum + (item.price * item.qty), 0);
  const appliedDelivery = orderType === 'Delivery' ? deliveryCharge : 0;
  // Tax sits between the discount and the delivery fee, matching the order the
  // server applies them in.
  const total = Math.max(0, subtotal - discountAmount - employeeDiscount) + taxAmount + appliedDelivery;

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
                key={`${item.id}-${item.name}`}
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
                    {formatMoney(item.price * item.qty)}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ fontSize: 12, color: '#A3A39A' }}>{formatMoney(item.price)} each</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button
                      onClick={() => onUpdateQty(item.id, item.name, -1)}
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
                      onClick={() => onUpdateQty(item.id, item.name, 1)}
                      style={{
                        width: 26, height: 26, borderRadius: '50%',
                        background: '#FEEFD0', color: '#DC2626',
                        border: '1.5px solid rgba(220,38,38,0.30)', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      <Plus size={12} />
                    </button>
                    <button
                      onClick={() => onRemoveItem(item.id, item.name)}
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
        {/* Dine-in / Delivery toggle */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          {(['Dine-in', 'Delivery'] as const).map(type => {
            const active = orderType === type;
            return (
              <button
                key={type}
                onClick={() => onOrderTypeChange(type)}
                style={{
                  flex: 1,
                  height: 36,
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: active ? '#DC2626' : '#FFFFFF',
                  color: active ? '#FFFFFF' : '#6B6B63',
                  border: active ? '1px solid #DC2626' : '1.5px solid #EBEBEB',
                  transition: 'all 140ms',
                }}
              >
                {type}
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 13, color: '#A3A39A' }}>Subtotal</span>
          <span style={{ fontSize: 13, fontWeight: 500, color: '#111110' }}>{formatMoney(subtotal)}</span>
        </div>
        {/* FIX (Bug 6): this row used to be a hardcoded "- Rs. 0" label. */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: orderType === 'Delivery' ? 8 : 14,
        }}>
          <span style={{ fontSize: 13, color: '#A3A39A' }}>Discount</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1.5px solid #EBEBEB' }}>
              {(['flat', 'percent'] as const).map(type => {
                const active = discountType === type;
                return (
                  <button
                    key={type}
                    onClick={() => onDiscountTypeChange(type)}
                    style={{
                      width: 26, height: 26, fontSize: 12, fontWeight: 700,
                      border: 'none', cursor: 'pointer',
                      background: active ? '#111111' : '#FFFFFF',
                      color: active ? '#FFFFFF' : '#A3A39A',
                    }}
                    title={type === 'flat' ? 'Flat amount' : 'Percent of subtotal'}
                  >
                    {type === 'flat' ? currencySymbol : '%'}
                  </button>
                );
              })}
            </div>
            <input
              type="number"
              min="0"
              value={discountValue}
              onChange={e => onDiscountValueChange(e.target.value)}
              placeholder="0"
              disabled={cart.length === 0}
              style={{
                width: 66, height: 26, borderRadius: 6,
                border: '1.5px solid #EBEBEB', background: '#FFFFFF',
                padding: '0 8px', fontSize: 13, fontWeight: 600,
                color: '#111110', textAlign: 'right', outline: 'none',
                fontFamily: 'Inter, sans-serif',
              }}
              onFocus={e => { e.currentTarget.style.borderColor = '#DC2626'; }}
              onBlur={e => { e.currentTarget.style.borderColor = '#EBEBEB'; }}
            />
          </div>
        </div>

        {discountAmount > 0 && (
          <div style={{
            display: 'flex', justifyContent: 'space-between',
            marginBottom: orderType === 'Delivery' ? 8 : 14,
          }}>
            <span style={{ fontSize: 12, color: '#A3A39A' }}>
              Discount applied{discountType === 'percent' ? ` (${Number(discountValue) || 0}%)` : ''}
            </span>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#16A34A' }}>
              − {formatMoney(discountAmount)}
            </span>
          </div>
        )}
        {/*
          Staff purchase. Sits directly under the discount row because it is a
          second, automatic discount — the cashier flips it instead of typing a
          percentage, and the rate is set once in Settings so it cannot drift
          between tills or be keyed in wrong.
        */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: 14, paddingBottom: 14, borderBottom: '1px solid #EBEBEB',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 13, color: '#A3A39A' }}>Staff purchase</span>
            <span style={{ fontSize: 11, color: '#C4C4BD' }}>
              {employeeDiscountRate}% off automatically
            </span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={isEmployee}
            aria-label="Staff purchase"
            onClick={() => onIsEmployeeChange(!isEmployee)}
            disabled={cart.length === 0}
            style={{
              width: 44, height: 24, borderRadius: 12, position: 'relative',
              border: 'none', padding: 0,
              cursor: cart.length === 0 ? 'not-allowed' : 'pointer',
              opacity: cart.length === 0 ? 0.5 : 1,
              background: isEmployee ? '#DC2626' : '#E5E5E0',
              transition: 'background 140ms',
            }}
          >
            <span style={{
              position: 'absolute', top: 3, left: isEmployee ? 23 : 3,
              width: 18, height: 18, borderRadius: 9, background: '#FFFFFF',
              transition: 'left 140ms', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            }} />
          </button>
        </div>

        {employeeDiscount > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
            <span style={{ fontSize: 13, color: '#A3A39A' }}>
              Staff Discount ({employeeDiscountRate}%)
            </span>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#16A34A' }}>
              − {formatMoney(employeeDiscount)}
            </span>
          </div>
        )}

        {taxAmount > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
            <span style={{ fontSize: 13, color: '#A3A39A' }}>
              Tax{taxRate ? ` (${taxRate}%)` : ''}
            </span>
            <span style={{ fontSize: 13, fontWeight: 500, color: '#111110' }}>
              {formatMoney(taxAmount, { decimals: taxAmount % 1 !== 0 })}
            </span>
          </div>
        )}
        {orderType === 'Delivery' && (
          <div style={{
            display: 'flex', justifyContent: 'space-between',
            marginBottom: 14, paddingBottom: 14,
            borderBottom: '1px solid #EBEBEB',
          }}>
            <span style={{ fontSize: 13, color: '#A3A39A' }}>Delivery Charge</span>
            <span style={{ fontSize: 13, fontWeight: 500, color: '#111110' }}>{formatMoney(deliveryCharge)}</span>
          </div>
        )}
        {orderType !== 'Delivery' && (
          <div style={{ borderBottom: '1px solid #EBEBEB', marginBottom: 14, paddingBottom: 14 }} />
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: '#111110' }}>Total</span>
          <span style={{ fontSize: 16, fontWeight: 700, color: '#DC2626' }}>{formatMoney(total, { decimals: total % 1 !== 0 })}</span>
        </div>

        {/* FIX (Bug 6): payment method was hardcoded to 'Cash' on every order,
            which made the payment breakdown in Reports meaningless. */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          {PAYMENT_METHODS.map(method => {
            const active = paymentMethod === method;
            const Icon = PAYMENT_ICONS[method];
            return (
              <button
                key={method}
                onClick={() => onPaymentMethodChange(method)}
                style={{
                  flex: 1, height: 34, borderRadius: 8,
                  fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                  background: active ? '#FEEFD0' : '#FFFFFF',
                  color: active ? '#B91C1C' : '#6B6B63',
                  border: active ? '1.5px solid #DC2626' : '1.5px solid #EBEBEB',
                  transition: 'all 140ms',
                }}
              >
                <Icon size={13} />
                {method}
              </button>
            );
          })}
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
              background: cart.length === 0 ? '#EBEBEB' : '#111111',
              color: cart.length === 0 ? '#BCBCB4' : '#FFFFFF',
              fontSize: 14, fontWeight: 600,
              cursor: cart.length === 0 ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              boxShadow: cart.length > 0 ? '0 2px 8px rgba(17,17,17,0.22)' : 'none',
              transition: 'all 140ms',
            }}
            onMouseEnter={e => { if (cart.length > 0) e.currentTarget.style.background = '#000000'; }}
            onMouseLeave={e => { if (cart.length > 0) e.currentTarget.style.background = '#111111'; }}
          >
            <CreditCard size={17} />
            Charge Order
          </button>
        </div>
      </div>
    </div>
  );
}

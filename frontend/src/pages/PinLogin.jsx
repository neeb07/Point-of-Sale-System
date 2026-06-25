import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Delete } from 'lucide-react';
import { staffAPI } from '@/api/index';

function getInitials(name) {
  const parts = name.split(' ');
  return (parts[0]?.[0] || '') + (parts[1]?.[0] || '');
}

const INACTIVITY_MS = 5 * 60 * 1000;

export default function PinLogin({ onLogin }) {
  const [staff, setStaff] = useState([]);
  const [selectedStaff, setSelectedStaff] = useState(null);
  const [pin, setPin] = useState('');
  const [shake, setShake] = useState(false);
  const [error, setError] = useState('');
  const lastActivity = useRef(Date.now());

  const loadStaff = useCallback(async () => {
    try {
      const data = await staffAPI.getAll();
      const active = data.filter((s) => s.active).map((s) => ({
        ...s,
        color: s.color || '#F97316',
        status: 'Active',
      }));
      setStaff(active);
      // Don't auto-select - let user choose their account
      setSelectedStaff(null);
    } catch {
      const fallback = { id: 1, name: 'Admin', role: 'Manager', color: '#F97316', active: 1 };
      setStaff([fallback]);
      setSelectedStaff(null);
    }
  }, []);

  useEffect(() => { loadStaff(); }, [loadStaff]);

  const resetActivity = () => { lastActivity.current = Date.now(); };

  useEffect(() => {
    const events = ['click', 'keypress', 'mousemove'];
    events.forEach((e) => window.addEventListener(e, resetActivity));
    return () => events.forEach((e) => window.removeEventListener(e, resetActivity));
  }, []);

  const submitPin = useCallback(async (pinValue) => {
    if (!selectedStaff) return;
    try {
      const result = await staffAPI.login(pinValue);
      if (result.id !== selectedStaff.id) {
        setShake(true);
        setError('Incorrect PIN');
        setPin('');
        setTimeout(() => { setShake(false); setError(''); }, 2000);
        return;
      }
      onLogin({ ...selectedStaff, ...result });
    } catch {
      setShake(true);
      setError('Incorrect PIN');
      setPin('');
      setTimeout(() => { setShake(false); setError(''); }, 2000);
    }
  }, [selectedStaff, onLogin]);

  const handleDigit = (digit) => {
    resetActivity();
    if (pin.length >= 4) return;
    const next = pin + digit;
    setPin(next);
    if (next.length === 4) {
      setTimeout(() => submitPin(next), 150);
    }
  };

  const handleBackspace = () => {
    resetActivity();
    setPin((p) => p.slice(0, -1));
  };

  const numpadKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'];

  return (
    <div style={{
      width: '100vw', height: '100vh', background: '#F9FAFB',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'Inter', sans-serif",
    }}>
      <div style={{ fontSize: 24, fontWeight: 700, color: '#111827' }}>Al-Madina Fast Food</div>
      <div style={{ fontSize: 14, color: '#6B7280', marginTop: 8 }}>
        {selectedStaff ? `Enter your PIN to continue as ${selectedStaff.name}` : 'Select your account to continue'}
      </div>

      <div style={{ display: 'flex', gap: 16, marginTop: 32 }}>
        {staff.map((s) => (
          <button
            key={s.id}
            onClick={() => { setSelectedStaff(s); setPin(''); resetActivity(); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', textAlign: 'center' }}
          >
            <div style={{
              width: 52, height: 52, borderRadius: 9999, background: s.color || '#F97316',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#FFFFFF', fontWeight: 700, fontSize: 16,
              border: selectedStaff?.id === s.id ? '3px solid #FFFFFF' : 'none',
              outline: selectedStaff?.id === s.id ? '2px solid #F97316' : 'none',
              outlineOffset: 2,
              opacity: selectedStaff && selectedStaff.id !== s.id ? 0.5 : 1,
            }}>
              {getInitials(s.name)}
            </div>
            <div style={{ fontSize: 11, color: '#374151', marginTop: 6 }}>{s.name.split(' ')[0]}</div>
          </button>
        ))}
      </div>

      {selectedStaff && (
        <>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#F97316', marginTop: 16 }}>{selectedStaff.name}</div>

          <div
            style={{
              display: 'flex', gap: 12, marginTop: 24,
              animation: shake ? 'shake 0.5s' : 'none',
            }}
          >
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                style={{
                  width: 18, height: 18, borderRadius: 9999,
                  border: `2px solid ${pin.length > i ? '#F97316' : '#D1D5DB'}`,
                  background: pin.length > i ? '#F97316' : '#FFFFFF',
                }}
              />
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 72px)', gap: 10, marginTop: 28 }}>
            {numpadKeys.map((key, idx) => {
              if (key === '') return <div key={idx} />;
              if (key === 'back') {
                return (
                  <button
                    key={idx}
                    onClick={handleBackspace}
                    style={{
                      width: 72, height: 60, borderRadius: 12, background: '#FFFFFF',
                      border: '1px solid #E5E7EB', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <Delete size={22} color="#6B7280" />
                  </button>
                );
              }
              return (
                <button
                  key={idx}
                  onClick={() => handleDigit(key)}
                  style={{
                    width: 72, height: 60, borderRadius: 12, background: '#FFFFFF',
                    border: '1px solid #E5E7EB', fontSize: 20, fontWeight: 600, color: '#111827',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#FFF7ED'; e.currentTarget.style.borderColor = '#F97316'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = '#FFFFFF'; e.currentTarget.style.borderColor = '#E5E7EB'; }}
                >
                  {key}
                </button>
              );
            })}
          </div>
        </>
      )}

      {error && <div style={{ fontSize: 13, color: '#EF4444', marginTop: 12 }}>{error}</div>}

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20%, 60% { transform: translateX(-8px); }
          40%, 80% { transform: translateX(8px); }
        }
      `}</style>
    </div>
  );
}

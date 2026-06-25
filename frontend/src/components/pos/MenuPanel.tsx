import React, { useState } from 'react';
import { usePOS } from '@/lib/POSContext';

interface MenuItem {
  id: number;
  name: string;
  category: string;
  price: number;
  image_url?: string;
}

interface MenuPanelProps {
  onAddToCart: (item: { id: number; name: string; price: number }) => void;
  search: string;
}

interface ItemCardProps {
  item: MenuItem;
  onAdd: () => void;
}

function getFoodImage(name: string): string {
  let seed = 0;
  for (let i = 0; i < name.length; i++) seed += name.charCodeAt(i);
  const prompt = encodeURIComponent(`${name} food dish appetizing`);
  return `https://image.pollinations.ai/prompt/${prompt}?width=300&height=200&nologo=true&seed=${seed}`;
}

export default function MenuPanel({ onAddToCart, search }: MenuPanelProps) {
  const { menuItems } = usePOS();
  const [activeCategory, setActiveCategory] = useState('All');

  const categories = ['All', ...new Set(menuItems.map(item => item.category))];

  const filteredItems = menuItems.filter(item => {
    if (search) return item.name.toLowerCase().includes(search.toLowerCase());
    return activeCategory === 'All' || item.category === activeCategory;
  });

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Category Tabs */}
      <div
        style={{
          height: 46,
          background: '#FFFFFF',
          borderBottom: '1px solid #EBEBEB',
          padding: '0 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          overflowX: 'auto',
          flexShrink: 0,
          scrollbarWidth: 'none',
        }}
      >
        {categories.map(cat => {
          const isActive = activeCategory === cat;
          return (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              style={{
                padding: '5px 14px',
                borderRadius: 7,
                fontSize: 13,
                fontWeight: isActive ? 600 : 500,
                color: isActive ? '#F97316' : '#A3A39A',
                background: isActive ? '#FFF7ED' : 'transparent',
                border: isActive ? '1.5px solid rgba(249,115,22,0.25)' : '1.5px solid transparent',
                cursor: 'pointer',
                flexShrink: 0,
                transition: 'all 140ms',
                whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => {
                if (!isActive) {
                  e.currentTarget.style.color = '#6B6B63';
                  e.currentTarget.style.background = '#F5F5F0';
                }
              }}
              onMouseLeave={e => {
                if (!isActive) {
                  e.currentTarget.style.color = '#A3A39A';
                  e.currentTarget.style.background = 'transparent';
                }
              }}
            >
              {cat}
            </button>
          );
        })}
      </div>

      {/* Item Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gridAutoRows: '190px',
          gap: 14,
          padding: 16,
          overflowY: 'auto',
          flex: 1,
          alignContent: 'start',
          background: '#F5F5F0',
        }}
      >
        {filteredItems.map(item => (
          <ItemCard key={item.id} item={item} onAdd={() => onAddToCart(item)} />
        ))}
      </div>
    </div>
  );
}

function ItemCard({ item, onAdd }: ItemCardProps) {
  const [pressed, setPressed] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);

  const handleClick = () => {
    setPressed(true);
    onAdd();
    setTimeout(() => setPressed(false), 150);
  };

  return (
    <div
      onClick={handleClick}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      style={{
        transform: pressed ? 'scale(0.97)' : 'scale(1)',
        background: '#FFFFFF',
        border: '1.5px solid #EBEBEB',
        borderRadius: 12,
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        overflow: 'hidden',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        cursor: 'pointer',
        transition: 'transform 120ms, box-shadow 120ms, border-color 120ms',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.boxShadow = '0 4px 14px rgba(0,0,0,0.09)';
        e.currentTarget.style.borderColor = 'rgba(249,115,22,0.30)';
        if (!pressed) e.currentTarget.style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.05)';
        e.currentTarget.style.borderColor = '#EBEBEB';
        e.currentTarget.style.transform = 'scale(1)';
      }}
    >
      {/* Image */}
      <div
        style={{
          height: 118, width: '100%',
          background: '#F5F5F0',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative',
        }}
      >
        {!imgLoaded && !imgError && (
          <div style={{
            width: 88, height: 88, borderRadius: 9999,
            background: '#EBEBEB',
            position: 'absolute',
          }} />
        )}
        {imgError ? (
          <div style={{
            width: 88, height: 88, borderRadius: 9999,
            background: '#F0F0EB',
            border: '3px solid #FFFFFF',
            boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 26,
          }}>
            🍽
          </div>
        ) : (
          <img
            src={item.image_url || getFoodImage(item.name)}
            alt={item.name}
            loading="lazy"
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgError(true)}
            style={{
              width: 88, height: 88, borderRadius: 9999,
              objectFit: 'cover',
              border: '3px solid #FFFFFF',
              boxShadow: '0 2px 8px rgba(0,0,0,0.10)',
              opacity: imgLoaded ? 1 : 0,
              transition: 'opacity 0.3s ease',
              position: 'relative',
            }}
          />
        )}
      </div>

      {/* Text */}
      <div style={{ padding: '10px 12px 12px', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{
          fontSize: 13, fontWeight: 500, color: '#111110',
          textAlign: 'center', marginBottom: 5,
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          lineHeight: '1.3',
        }}>
          {item.name}
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#F97316', textAlign: 'center' }}>
          Rs. {item.price.toLocaleString()}
        </div>
      </div>
    </div>
  );
}

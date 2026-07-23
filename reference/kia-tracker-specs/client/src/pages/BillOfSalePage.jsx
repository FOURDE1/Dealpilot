import { useEffect, useRef, useState } from 'react';
import BillOfSale from '../components/desking/BillOfSale';
import { BOS_SESSION_KEY } from '../utils/billOfSale';

function readPayload() {
  try {
    const raw = localStorage.getItem(BOS_SESSION_KEY);
    if (!raw) return { data: null, error: 'No bill-of-sale payload found. Generate from the Desking page.' };
    return { data: JSON.parse(raw), error: null };
  } catch (err) {
    return { data: null, error: err?.message || 'Failed to load bill of sale' };
  }
}

export default function BillOfSalePage() {
  // Lazy initializer runs once per mount (StrictMode safe).
  const [{ data, error }] = useState(readPayload);
  const printed = useRef(false);

  useEffect(() => {
    if (!data || printed.current) return;
    printed.current = true;
    const id = setTimeout(() => { window.print(); }, 500);
    return () => clearTimeout(id);
  }, [data]);

  if (error) return <div style={{ padding: 40, fontFamily: 'Arial' }}>{error}</div>;
  if (!data) return <div style={{ padding: 40, fontFamily: 'Arial' }}>Loading…</div>;
  return <BillOfSale data={data} />;
}

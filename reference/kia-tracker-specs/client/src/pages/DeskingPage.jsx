import { useEffect, useState, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '../supabaseClient';
import { useDesking, loadScenarios, saveScenarios } from '../hooks/useDesking';
import DeskingTopBar from '../components/desking/DeskingTopBar';
import VehicleSummary from '../components/desking/VehicleSummary';
import VehiclePanel from '../components/desking/VehiclePanel';
import DealStructureCard from '../components/desking/DealStructureCard';
import SummaryRows from '../components/desking/SummaryRows';
import PaymentSummary from '../components/desking/PaymentSummary';
import TradeInPanel from '../components/desking/TradeInPanel';
import FeesPanel from '../components/desking/FeesPanel';
import FIProductsPanel from '../components/desking/FIProductsPanel';
import RebatesPanel from '../components/desking/RebatesPanel';
import PdfDropZone from '../components/desking/PdfDropZone';
import PdfImportConfirmation from '../components/desking/PdfImportConfirmation';
import LenderManagePanel from '../components/desking/LenderManagePanel';
import CustomerCard from '../components/desking/CustomerCard';
import AttachClientModal from '../components/desking/AttachClientModal';
import { parseDealerTrackPdf } from '../utils/dealertrackPdfParser';
import { findLenderByName } from '../utils/lenderData';
import { getBillOfSaleData, BOS_SESSION_KEY } from '../utils/billOfSale';

const API_URL = import.meta.env.VITE_API_URL;

function mapDealToOverrides(deal) {
  if (!deal) return {};
  const overrides = {
    dealId: deal.id,
    customerName: deal.customer_name || '',
    vehicle: {
      year: deal.vehicle_year || '',
      make: deal.vehicle_make || '',
      model: deal.vehicle_model || '',
      color: deal.vehicle_color || '',
      vin: deal.vin || '',
      stock: deal.stock_number || '',
      mileage: deal.vehicle_mileage || 0,
      condition: deal.vehicle_condition || 'new',
    },
    salePrice: Number(deal.sale_price) || 0,
    msrp: Number(deal.msrp) || Number(deal.sale_price) || 0,
    vehicleCost: Number(deal.vehicle_cost) || 0,
  };
  if (deal.trade_allowance) {
    overrides.trades = [{
      enabled: true,
      year: deal.trade_year || '',
      make: deal.trade_make || '',
      model: deal.trade_model || '',
      mileage: deal.trade_mileage || 0,
      vin: deal.trade_vin || '',
      acv: Number(deal.trade_acv) || 0,
      allowance: Number(deal.trade_allowance) || 0,
      lien: Number(deal.trade_lien) || 0,
    }];
  }
  if (deal.native_status) overrides.nativeStatus = true;
  if (deal.province_code) overrides.provinceCode = deal.province_code;
  return overrides;
}

export default function DeskingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const dealIdParam = searchParams.get('dealId');

  const desk = useDesking();
  const { state, computed } = desk;

  const [scenarios, setScenarios] = useState(() => loadScenarios());
  const [openPanel, setOpenPanel] = useState(null); // 'vehicle'|'trade'|'fees'|'products'|'rebates'|'lenders'|null
  const [pdfDropVisible, setPdfDropVisible] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfResult, setPdfResult] = useState(null);
  const [pdfError, setPdfError] = useState(null);

  const qc = useQueryClient();

  const [attachModalOpen, setAttachModalOpen] = useState(false);
  const [attachRole, setAttachRole] = useState('buyer');

  const { data: deals = [] } = useQuery({
    queryKey: ['deals-lite'],
    queryFn: async () => {
      const r = await fetch(`${API_URL}/deals`);
      if (!r.ok) return [];
      return r.json();
    },
    staleTime: 30_000,
  });

  const { data: dealParties = [] } = useQuery({
    queryKey: ['deal-parties', state.dealId],
    enabled: !!state.dealId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('deal_parties')
        .select('id, deal_id, contact_id, role, contacts(id, first_name, last_name, email, phone)')
        .eq('deal_id', state.dealId);
      if (error) { console.error('deal_parties error:', error); return []; }
      return (data || []).map((dp) => ({
        id: dp.id,
        deal_id: dp.deal_id,
        contact_id: dp.contact_id,
        role: dp.role,
        first_name: dp.contacts?.first_name || '',
        last_name: dp.contacts?.last_name || '',
        email: dp.contacts?.email || '',
        phone: dp.contacts?.phone || '',
      }));
    },
  });

  const buyer = dealParties.find((p) => p.role === 'buyer') || null;
  const coBuyer = dealParties.find((p) => p.role === 'cosigner') || null;

  const refreshParties = () => qc.invalidateQueries({ queryKey: ['deal-parties', state.dealId] });

  const handleConvertLegacy = async () => {
    try {
      const dealRes = await fetch(`${API_URL}/deals/${state.dealId}`);
      if (!dealRes.ok) throw new Error('Failed to load deal');
      const freshDeal = await dealRes.json();
      if (!freshDeal.customer_name) {
        alert('No legacy customer name to convert.');
        return;
      }
      const parts = freshDeal.customer_name.trim().split(/\s+/);
      const first = parts[0] || '';
      const last = parts.slice(1).join(' ') || '';
      const payload = {
        first_name: first,
        last_name: last,
        phone: freshDeal.customer_phone || '',
        address: freshDeal.customer_address || '',
      };

      // Try creating contact; if duplicate found (409), use the existing one
      let contactId;
      const res = await fetch(`${API_URL}/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.status === 409) {
        const dup = await res.json();
        contactId = dup.duplicates?.[0]?.id;
        if (!contactId) throw new Error('Duplicate detected but no ID returned');
      } else if (res.ok) {
        const contact = await res.json();
        contactId = contact.id;
      } else {
        throw new Error('Failed to create contact');
      }

      await supabase.from('deal_parties').delete().eq('deal_id', state.dealId).eq('role', 'buyer');
      const { error: insertErr } = await supabase.from('deal_parties').insert({ deal_id: state.dealId, contact_id: contactId, role: 'buyer' });
      if (insertErr) throw insertErr;
      await fetch(`${API_URL}/deals/${state.dealId}/sync-customer`, { method: 'POST' });
      qc.invalidateQueries({ queryKey: ['deals-lite'] });
      refreshParties();
      alert('Customer converted to contact and attached.');
    } catch (err) {
      alert('Failed to convert legacy customer: ' + (err.message || err));
    }
  };

  const handleDetachParty = async (partyId) => {
    const { error } = await supabase.from('deal_parties').delete().eq('id', partyId);
    if (error) { alert('Failed to detach: ' + error.message); return; }
    // Keep last-known legacy fields on detach — don't clear deals.customer_*
    refreshParties();
  };

  const handleConvertToDeal = () => {
    navigate('/deal/new', {
      state: {
        sourceDealId: state.dealId,
        province: state.provinceCode,
        primary_contact_id: buyer?.contact_id || null,
        co_buyer_contact_id: coBuyer?.contact_id || null,
      },
    });
  };

  useEffect(() => {
    if (dealIdParam && deals.length > 0) {
      const d = deals.find((x) => x.id === dealIdParam);
      if (d) desk.reset(mapDealToOverrides(d));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealIdParam, deals]);

  const handleSelectDeal = (id) => {
    if (!id) { desk.reset(); return; }
    const d = deals.find((x) => x.id === id);
    if (d) desk.reset(mapDealToOverrides(d));
  };

  const handleSaveScenario = () => {
    const defName = `${state.vehicle?.year || ''} ${state.vehicle?.model || 'Scenario'} — ${computed.active?.term || ''}mo`.trim();
    const name = prompt(t('desking.scenarioNamePrompt'), defName);
    if (!name) return;
    const snapshot = {
      dealType: state.dealType,
      monthly: computed.active?.monthly || 0,
      term: computed.active?.term || 0,
      rate: computed.active?.rate || 0,
      totalDown: computed.totalDownFinance,
      totalCost: computed.active?.totalCost || 0,
    };
    const entry = { id: crypto.randomUUID(), name, snapshot, state, recommended: false, createdAt: Date.now() };
    const next = [entry, ...scenarios].slice(0, 4);
    setScenarios(next);
    saveScenarios(next);
  };

  const handleLoadScenario = (s) => { if (s?.state) desk.loadState(s.state); };
  const handleDeleteScenario = (id) => {
    const next = scenarios.filter((s) => s.id !== id);
    setScenarios(next); saveScenarios(next);
  };
  const handleToggleRecommend = (id) => {
    const next = scenarios.map((s) => ({ ...s, recommended: s.id === id ? !s.recommended : false }));
    setScenarios(next); saveScenarios(next);
  };

  const handlePrint = () => window.print();
  const handleSendFI = () => alert(t('desking.sentToFi'));

  // ---- Bill of Sale ----
  const currentDeal = deals.find((d) => d.id === state.dealId) || null;

  const openBillOfSale = () => {
    const payload = getBillOfSaleData(state, currentDeal);
    try {
      localStorage.setItem(BOS_SESSION_KEY, JSON.stringify(payload));
    } catch (e) {
      alert('Unable to stage bill of sale data.');
      return;
    }
    window.open('/bill-of-sale', '_blank', 'noopener,noreferrer');
  };

  const handlePrintBillOfSale = () => openBillOfSale();
  const handleSavePdfBillOfSale = () => openBillOfSale(); // browser print dialog lets user save as PDF

  const handleEmailBillOfSale = () => {
    const v = state.vehicle || {};
    const title = `${v.year || ''} ${v.make || ''} ${v.model || ''}`.trim();
    const customerName = currentDeal?.customer_name || state.customerName || '';
    const subject = encodeURIComponent(`Vehicle Purchase Agreement — ${title} — ${customerName}`.trim());
    const body = encodeURIComponent('Please find attached the Vehicle Purchase Agreement for your review.');
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };
  const handleSaveReturn = () => state.dealId ? navigate(`/deal/${state.dealId}`) : navigate(-1);

  // Lender actions
  const handleSelectLender = useCallback((lender) => {
    desk.setLender(lender);
    if (lender?.defaultRate != null && lender.defaultRate !== state.interestRate) {
      // Ask before overwriting the rate
      const ask = confirm(t('desking.useDefaultRate', { lender: lender.shortName || lender.name, rate: lender.defaultRate }));
      if (ask) desk.setField('interestRate', lender.defaultRate);
    }
  }, [desk, state.interestRate, t]);

  // PDF handling
  const processFile = useCallback(async (file) => {
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name?.toLowerCase().endsWith('.pdf')) {
      setPdfError('Not a PDF file.');
      setPdfResult({ success: false, error: 'Only PDF files are supported.', data: {} });
      setPdfDropVisible(false);
      return;
    }
    setPdfLoading(true);
    try {
      const buffer = await file.arrayBuffer();
      const result = await parseDealerTrackPdf(buffer);
      setPdfResult(result);
      setPdfError(result.success ? null : result.error);
    } catch (err) {
      setPdfResult({ success: false, error: err?.message || 'Failed to parse', data: {} });
    } finally {
      setPdfLoading(false);
      setPdfDropVisible(false);
    }
  }, []);

  // Page-level drag listeners to auto-open drop overlay.
  useEffect(() => {
    let dragDepth = 0;
    const onDragEnter = (e) => {
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes('Files')) return;
      dragDepth++;
      setPdfDropVisible(true);
    };
    const onDragLeave = () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) setPdfDropVisible(false);
    };
    const onDragOver = (e) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
        e.preventDefault();
      }
    };
    const onDrop = () => { dragDepth = 0; };
    document.addEventListener('dragenter', onDragEnter);
    document.addEventListener('dragleave', onDragLeave);
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('drop', onDrop);
    return () => {
      document.removeEventListener('dragenter', onDragEnter);
      document.removeEventListener('dragleave', onDragLeave);
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('drop', onDrop);
    };
  }, []);

  const handleImportPdf = (payload, lender) => {
    desk.importPdfData(payload, lender || null);
    setPdfResult(null);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-gray-100 -mx-4 -my-4 sm:-mx-6 sm:-my-6 print:bg-white">
      <div className="h-1 bg-gradient-to-r from-red-700 via-red-600 to-red-500 print:hidden" />
      <DeskingTopBar
        deals={deals}
        state={state}
        computed={computed}
        onSelectDeal={handleSelectDeal}
        onSetField={desk.setField}
        onReset={() => desk.reset()}
        onPrint={handlePrint}
        onOpenPdf={() => setPdfDropVisible(true)}
        onSelectLender={handleSelectLender}
        onOpenManageLenders={() => setOpenPanel('lenders')}
        onPrintBillOfSale={handlePrintBillOfSale}
        onSavePdfBillOfSale={handleSavePdfBillOfSale}
        onEmailBillOfSale={handleEmailBillOfSale}
      />

      <div className="hidden print:block p-6">
        <h1 className="text-2xl font-bold">Kia Mont-Laurier — {t('desking.proposal')}</h1>
        <p className="text-sm text-gray-600 mb-4">{state.customerName || ''} · {state.vehicle?.year} {state.vehicle?.make} {state.vehicle?.model}</p>
        {state.selectedLender && (
          <p className="text-sm text-gray-700 mb-2">
            <strong>{t('desking.financingThrough')}:</strong> {state.selectedLender.name}
          </p>
        )}
      </div>

      <div className="p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3 space-y-3">
          {state.dealId && (
            <CustomerCard
              dealId={state.dealId}
              buyer={buyer}
              coBuyer={coBuyer}
              legacyCustomer={!buyer && currentDeal?.customer_name ? {
                name: currentDeal.customer_name,
                phone: currentDeal.customer_phone,
                address: currentDeal.customer_address,
              } : null}
              onAttachClick={() => { setAttachRole('buyer'); setAttachModalOpen(true); }}
              onDetach={handleDetachParty}
              onChangeBuyer={() => { setAttachRole('buyer'); setAttachModalOpen(true); }}
              onAddCoBuyer={() => { setAttachRole('cosigner'); setAttachModalOpen(true); }}
              onConvertLegacy={handleConvertLegacy}
            />
          )}
          <VehicleSummary state={state} onEdit={() => setOpenPanel('vehicle')} />
          <DealStructureCard
            state={state}
            computed={computed}
            setField={desk.setField}
            onOpenRebates={() => setOpenPanel('rebates')}
            onOpenLenderManage={() => setOpenPanel('lenders')}
          />
          <SummaryRows state={state} computed={computed} onOpen={setOpenPanel} />
        </div>

        <div className="lg:col-span-2">
          <PaymentSummary
            state={state}
            computed={computed}
            dealId={state.dealId}
            buyer={buyer}
            scenarios={scenarios}
            onSaveScenario={handleSaveScenario}
            onLoadScenario={handleLoadScenario}
            onDeleteScenario={handleDeleteScenario}
            onToggleRecommend={handleToggleRecommend}
            onPrint={handlePrint}
            onSaveReturn={handleSaveReturn}
            onSendFI={handleSendFI}
            onConvertToDeal={handleConvertToDeal}
          />
        </div>
      </div>

      <VehiclePanel open={openPanel === 'vehicle'} onClose={() => setOpenPanel(null)} state={state} setVehicle={desk.setVehicle} setField={desk.setField} />
      <TradeInPanel open={openPanel === 'trade'} onClose={() => setOpenPanel(null)} state={state} setTrade={desk.setTrade} addTrade={desk.addTrade} removeTrade={desk.removeTrade} />
      <FeesPanel open={openPanel === 'fees'} onClose={() => setOpenPanel(null)} state={state} computed={computed} updateFee={desk.updateFee} addFee={desk.addFee} removeFee={desk.removeFee} />
      <FIProductsPanel open={openPanel === 'products'} onClose={() => setOpenPanel(null)} state={state} computed={computed} updateProduct={desk.updateProduct} addProduct={desk.addProduct} removeProduct={desk.removeProduct} />
      <RebatesPanel open={openPanel === 'rebates'} onClose={() => setOpenPanel(null)} state={state} computed={computed} addRebate={desk.addRebate} updateRebate={desk.updateRebate} removeRebate={desk.removeRebate} />
      <LenderManagePanel open={openPanel === 'lenders'} onClose={() => setOpenPanel(null)} />

      <PdfDropZone
        visible={pdfDropVisible}
        loading={pdfLoading}
        onFile={processFile}
        onClose={() => setPdfDropVisible(false)}
      />

      <PdfImportConfirmation
        open={!!pdfResult}
        onClose={() => setPdfResult(null)}
        result={pdfResult}
        state={state}
        onImport={handleImportPdf}
      />

      <AttachClientModal
        open={attachModalOpen}
        onClose={() => setAttachModalOpen(false)}
        dealId={state.dealId}
        role={attachRole}
        onAttached={refreshParties}
      />

      {pdfError && !pdfResult && (
        <div className="fixed bottom-4 right-4 z-[80] bg-red-600 text-white px-4 py-2 rounded-lg shadow-lg text-sm">
          {pdfError}
        </div>
      )}

      <style>{`
        @media print {
          nav, aside, header, .print\\:hidden { display: none !important; }
          body { background: white !important; }
          .shadow-sm, .shadow-lg, .shadow-md { box-shadow: none !important; }
        }
      `}</style>
    </div>
  );
}

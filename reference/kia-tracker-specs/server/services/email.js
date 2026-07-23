const { Resend } = require('resend');

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

function formatBoolean(val) {
  return val ? 'Yes' : 'No';
}

function formatCurrency(val) {
  if (!val) return '$0.00';
  return `$${Number(val).toFixed(2)}`;
}

async function sendDealClosingEmail(deal) {
  if (!resend) return { success: false, error: 'Resend API key not configured' };
  const tradeSection = deal.has_trade_in
    ? `
    <tr><td colspan="2" style="background:#f3f4f6;padding:8px;font-weight:bold;">Trade-In Details</td></tr>
    <tr><td>Trade Vehicle</td><td>${deal.trade_year || ''} ${deal.trade_make || ''} ${deal.trade_model || ''} ${deal.trade_color || ''}</td></tr>
    <tr><td>Trade Plate</td><td>${deal.trade_plate || 'N/A'}</td></tr>
    <tr><td>Trade VIN</td><td>${deal.trade_vin || 'N/A'}</td></tr>
    <tr><td>Trade Stock #</td><td>${deal.trade_stock_number || 'N/A'}</td></tr>
    <tr><td>Lien on Trade</td><td>${formatBoolean(deal.has_lien)}</td></tr>
    ${deal.has_lien ? `<tr><td>Lien Bank</td><td>${deal.lien_bank || 'N/A'}</td></tr>
    <tr><td>Lien Amount</td><td>${formatCurrency(deal.lien_amount)}</td></tr>` : ''}
    `
    : '<tr><td>Trade-In</td><td>No</td></tr>';

  const html = `
  <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;">
    <h2 style="color:#1e3a5f;border-bottom:2px solid #c4342d;padding-bottom:8px;">
      Deal Closing Report — Kia Mont-Laurier
    </h2>
    <table style="width:100%;border-collapse:collapse;" cellpadding="8">
      <tr><td colspan="2" style="background:#f3f4f6;padding:8px;font-weight:bold;">Vehicle Information</td></tr>
      <tr><td>Stock #</td><td>${deal.stock_number || 'N/A'}</td></tr>
      <tr><td>VIN</td><td>${deal.vin || 'N/A'}</td></tr>
      <tr><td>Vehicle</td><td>${deal.year || ''} ${deal.make || ''} ${deal.model || ''} ${deal.color || ''}</td></tr>
      <tr><td>Vehicle Source</td><td>${deal.vehicle_source || 'N/A'}</td></tr>
      <tr><td>Listed Online</td><td>${formatBoolean(deal.listed_online)}</td></tr>

      <tr><td colspan="2" style="background:#f3f4f6;padding:8px;font-weight:bold;">Deal Information</td></tr>
      <tr><td>Customer</td><td>${deal.customer_name || 'N/A'}</td></tr>
      ${deal.has_cosigner ? `<tr><td>Co-signer</td><td>${deal.cosigner_name || 'N/A'}</td></tr>` : ''}
      <tr><td>Salesperson</td><td>${deal.salesperson_name || 'N/A'}</td></tr>
      <tr><td>Finance Bank</td><td>${deal.financing_bank || 'N/A'}</td></tr>
      <tr><td>Finance Status</td><td>${deal.finance_status || 'N/A'}</td></tr>
      <tr><td>Money Down</td><td>${formatCurrency(deal.money_down_amount)} — Collected: ${formatBoolean(deal.money_down_collected)}</td></tr>
      <tr><td>Cash Back</td><td>${formatCurrency(deal.cash_back_amount)} — Sent: ${formatBoolean(deal.cash_back_sent)}</td></tr>
      <tr><td>Accessories</td><td>${deal.accessories || 'None'}</td></tr>
      <tr><td>Native Status</td><td>${formatBoolean(deal.native_status)}</td></tr>

      <tr><td colspan="2" style="background:#f3f4f6;padding:8px;font-weight:bold;">Delivery / Compliance</td></tr>
      <tr><td>Licensing</td><td>${(deal.licensing_province || 'N/A').toUpperCase()} — Completed: ${formatBoolean(deal.licensing_completed)}</td></tr>
      <tr><td>Photos Taken</td><td>${formatBoolean(deal.photos_taken)}</td></tr>
      <tr><td>Wet Ink Signed</td><td>${formatBoolean(deal.wet_ink_signed)}</td></tr>
      <tr><td>IDV Completed</td><td>${formatBoolean(deal.idv_completed)}</td></tr>

      ${tradeSection}
    </table>
    <p style="color:#888;font-size:12px;margin-top:20px;">Sent automatically by Kia Mont-Laurier Deal Tracker</p>
  </div>
  `;

  const { data, error } = await resend.emails.send({
    from: process.env.EMAIL_FROM,
    to: process.env.DEAL_CLOSING_EMAIL.split(',').map(e => e.trim()),
    subject: `Deal Closed — ${deal.customer_name || 'Unknown'} — ${deal.year || ''} ${deal.make || ''} ${deal.model || ''} (Stock #${deal.stock_number || 'N/A'})`,
    html,
  });

  if (error) throw error;
  return data;
}

async function sendDriverDispatchEmail(deal) {
  if (!resend) return { success: false, error: 'Resend API key not configured' };
  const tradeSection = deal.has_trade_in
    ? `
    <tr><td colspan="2" style="background:#f3f4f6;padding:8px;font-weight:bold;">Trade-In to Pick Up</td></tr>
    <tr><td>Trade Vehicle</td><td>${deal.trade_year || ''} ${deal.trade_make || ''} ${deal.trade_model || ''} ${deal.trade_color || ''}</td></tr>
    <tr><td>Trade Plate</td><td>${deal.trade_plate || 'N/A'}</td></tr>
    <tr><td>Trade VIN</td><td>${deal.trade_vin || 'N/A'}</td></tr>
    <tr><td>Trade Stock #</td><td>${deal.trade_stock_number || 'N/A'}</td></tr>
    ${deal.has_lien ? `<tr><td>Lien</td><td>${deal.lien_bank || 'N/A'} — ${formatCurrency(deal.lien_amount)}</td></tr>` : ''}
    `
    : '<tr><td>Trade-In</td><td>No</td></tr>';

  const html = `
  <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;">
    <h2 style="color:#1e3a5f;border-bottom:2px solid #c4342d;padding-bottom:8px;">
      Driver Dispatch — Kia Mont-Laurier
    </h2>
    <table style="width:100%;border-collapse:collapse;" cellpadding="8">
      <tr><td colspan="2" style="background:#f3f4f6;padding:8px;font-weight:bold;">Client Information</td></tr>
      <tr><td>Client Name</td><td>${deal.customer_name || 'N/A'}</td></tr>
      ${deal.has_cosigner ? `<tr><td>Co-signer</td><td>${deal.cosigner_name || 'N/A'}</td></tr>` : ''}
      <tr><td>Address</td><td>${deal.customer_address || 'N/A'}</td></tr>
      <tr><td>Phone</td><td>${deal.customer_phone || 'N/A'}</td></tr>

      <tr><td colspan="2" style="background:#f3f4f6;padding:8px;font-weight:bold;">Vehicle Details</td></tr>
      <tr><td>Vehicle</td><td>${deal.year || ''} ${deal.make || ''} ${deal.model || ''}</td></tr>
      <tr><td>Stock #</td><td>${deal.stock_number || 'N/A'}</td></tr>
      <tr><td>VIN</td><td>${deal.vin || 'N/A'}</td></tr>
      <tr><td>Pickup Location</td><td>${deal.pickup_location || 'N/A'}</td></tr>
      <tr><td>Chaser Vehicle</td><td>${deal.chaser_vehicle_info || 'N/A'}</td></tr>

      <tr><td colspan="2" style="background:#f3f4f6;padding:8px;font-weight:bold;">Delivery Details</td></tr>
      <tr><td>Delivery Address</td><td>${deal.delivery_address || deal.customer_address || 'N/A'}</td></tr>
      <tr><td>Delivery Date/Time</td><td>${deal.delivery_date ? new Date(deal.delivery_date).toLocaleString() : 'N/A'}</td></tr>
      <tr><td>Salesperson</td><td>${deal.salesperson_name || 'N/A'}</td></tr>

      <tr><td colspan="2" style="background:#f3f4f6;padding:8px;font-weight:bold;">Collection / Documents</td></tr>
      <tr><td>Cash Down to Collect</td><td>${formatBoolean(deal.money_down_amount > 0 && !deal.money_down_collected)} ${deal.money_down_amount > 0 ? '— ' + formatCurrency(deal.money_down_amount) : ''}</td></tr>
      <tr><td>Cash Back</td><td>${deal.cash_back_amount > 0 ? formatCurrency(deal.cash_back_amount) : 'None'}</td></tr>
      <tr><td>Wet Ink to Sign</td><td>${formatBoolean(deal.wet_ink_signed === false)}</td></tr>

      ${tradeSection}
    </table>
    <p style="color:#888;font-size:12px;margin-top:20px;">Sent automatically by Kia Mont-Laurier Deal Tracker</p>
  </div>
  `;

  const { data, error } = await resend.emails.send({
    from: process.env.EMAIL_FROM,
    to: process.env.DRIVER_DISPATCH_EMAIL.split(',').map(e => e.trim()),
    subject: `Driver Dispatch — ${deal.customer_name || 'Unknown'} — ${deal.year || ''} ${deal.make || ''} ${deal.model || ''} (Stock #${deal.stock_number || 'N/A'})`,
    html,
  });

  if (error) throw error;
  return data;
}

module.exports = { sendDealClosingEmail, sendDriverDispatchEmail };

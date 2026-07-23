const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

const HEADER_COLOR = '1e3a5f';
const ACCENT_COLOR = 'c4342d';

function fmt(num) {
  return Number(num || 0).toLocaleString('en-CA', { style: 'currency', currency: 'CAD' });
}

function pct(num) {
  return (Number(num || 0) * 100).toFixed(0) + '%';
}

// ============================================================
// EXCEL GENERATION
// ============================================================

async function generateExcel(type, deals, commissions, period) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Kia Mont-Laurier';

  const headerStyle = {
    font: { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${HEADER_COLOR}` } },
    alignment: { horizontal: 'center' },
    border: {
      top: { style: 'thin' },
      bottom: { style: 'thin' },
      left: { style: 'thin' },
      right: { style: 'thin' },
    },
  };

  if (type === 'sales') {
    const ws = workbook.addWorksheet('Sales Performance');
    ws.columns = [
      { header: 'Salesperson', key: 'name', width: 25 },
      { header: 'Deals', key: 'deals', width: 10 },
      { header: 'Completed', key: 'completed', width: 12 },
      { header: 'Conv. Rate', key: 'convRate', width: 12 },
      { header: 'Total Sales', key: 'totalSales', width: 18 },
      { header: 'Total Gross', key: 'totalGross', width: 18 },
      { header: 'Total F&I', key: 'totalFI', width: 15 },
    ];
    ws.getRow(1).eachCell((cell) => Object.assign(cell, headerStyle));

    const byPerson = {};
    deals.forEach((d) => {
      const name = d.salesperson_name || 'Unknown';
      if (!byPerson[name]) byPerson[name] = { name, deals: 0, completed: 0, totalSales: 0, totalGross: 0, totalFI: 0 };
      byPerson[name].deals++;
      if (d.deal_status === 'complete') byPerson[name].completed++;
      byPerson[name].totalSales += Number(d.sale_price) || 0;
      byPerson[name].totalGross += (Number(d.sale_price) || 0) - (Number(d.vehicle_cost) || 0);
      byPerson[name].totalFI += Number(d.fi_reserve) || 0;
    });

    Object.values(byPerson)
      .sort((a, b) => b.totalGross - a.totalGross)
      .forEach((p) => {
        ws.addRow({
          ...p,
          convRate: p.deals > 0 ? `${(p.completed / p.deals * 100).toFixed(0)}%` : '0%',
          totalSales: Number(p.totalSales.toFixed(2)),
          totalGross: Number(p.totalGross.toFixed(2)),
          totalFI: Number(p.totalFI.toFixed(2)),
        });
      });

    // Format currency columns
    ['E', 'F', 'G'].forEach((col) => {
      ws.getColumn(col).numFmt = '$#,##0.00';
    });
  }

  if (type === 'commissions') {
    const ws = workbook.addWorksheet('Commission Report');
    ws.columns = [
      { header: 'Salesperson', key: 'name', width: 25 },
      { header: 'Deals', key: 'deals', width: 10 },
      { header: 'Rate', key: 'rate', width: 10 },
      { header: 'Pad', key: 'pad', width: 12 },
      { header: 'Gross for Comm.', key: 'grossForComm', width: 18 },
      { header: 'Commission', key: 'commission', width: 18 },
      { header: 'Overrides', key: 'overrides', width: 15 },
      { header: 'Total Earned', key: 'total', width: 18 },
    ];
    ws.getRow(1).eachCell((cell) => Object.assign(cell, headerStyle));

    const byPerson = {};
    commissions.forEach((c) => {
      const name = c.salesperson_name;
      if (!byPerson[name]) byPerson[name] = { name, deals: 0, rate: c.commission_rate, pad: c.pad_amount, grossForComm: 0, commission: 0, overrides: 0 };
      byPerson[name].deals++;
      byPerson[name].grossForComm += Number(c.gross_for_commission) || 0;
      byPerson[name].commission += Number(c.commission_amount) || 0;
    });

    commissions.forEach((c) => {
      if (c.override_salesperson && c.override_amount > 0) {
        if (!byPerson[c.override_salesperson]) byPerson[c.override_salesperson] = { name: c.override_salesperson, deals: 0, rate: 0, pad: 0, grossForComm: 0, commission: 0, overrides: 0 };
        byPerson[c.override_salesperson].overrides += Number(c.override_amount) || 0;
      }
    });

    Object.values(byPerson)
      .sort((a, b) => (b.commission + b.overrides) - (a.commission + a.overrides))
      .forEach((p) => {
        ws.addRow({
          ...p,
          rate: pct(p.rate),
          pad: Number(p.pad.toFixed(2)),
          grossForComm: Number(p.grossForComm.toFixed(2)),
          commission: Number(p.commission.toFixed(2)),
          overrides: Number(p.overrides.toFixed(2)),
          total: Number((p.commission + p.overrides).toFixed(2)),
        });
      });

    ['D', 'E', 'F', 'G', 'H'].forEach((col) => {
      ws.getColumn(col).numFmt = '$#,##0.00';
    });
  }

  if (type === 'financial') {
    const ws = workbook.addWorksheet('Financial Summary');
    ws.columns = [
      { header: 'Metric', key: 'metric', width: 30 },
      { header: 'Value', key: 'value', width: 20 },
    ];
    ws.getRow(1).eachCell((cell) => Object.assign(cell, headerStyle));

    const totalSales = deals.reduce((s, d) => s + (Number(d.sale_price) || 0), 0);
    const totalCost = deals.reduce((s, d) => s + (Number(d.vehicle_cost) || 0), 0);
    const totalGross = totalSales - totalCost;
    const totalFI = deals.reduce((s, d) => s + (Number(d.fi_reserve) || 0), 0);

    ws.addRow({ metric: 'Total Deals', value: deals.length });
    ws.addRow({ metric: 'Total Sales Revenue', value: totalSales });
    ws.addRow({ metric: 'Total Cost', value: totalCost });
    ws.addRow({ metric: 'Gross Profit', value: totalGross });
    ws.addRow({ metric: 'Total F&I Reserve', value: totalFI });
    ws.addRow({ metric: 'Net Gross (Profit + F&I)', value: totalGross + totalFI });
    ws.addRow({ metric: '', value: '' });

    const mdTotal = deals.reduce((s, d) => s + (Number(d.money_down_amount) || 0), 0);
    const mdCollected = deals.filter((d) => d.money_down_collected).reduce((s, d) => s + (Number(d.money_down_amount) || 0), 0);
    ws.addRow({ metric: 'Money Down Total', value: mdTotal });
    ws.addRow({ metric: 'Money Down Collected', value: mdCollected });
    ws.addRow({ metric: 'Money Down Outstanding', value: mdTotal - mdCollected });
    ws.addRow({ metric: '', value: '' });

    const cbTotal = deals.reduce((s, d) => s + (Number(d.cash_back_amount) || 0), 0);
    const cbSent = deals.filter((d) => d.cash_back_sent).reduce((s, d) => s + (Number(d.cash_back_amount) || 0), 0);
    ws.addRow({ metric: 'Cash Back Total', value: cbTotal });
    ws.addRow({ metric: 'Cash Back Sent', value: cbSent });
    ws.addRow({ metric: 'Cash Back Pending', value: cbTotal - cbSent });

    ws.getColumn('B').numFmt = '$#,##0.00';
  }

  if (type === 'inventory') {
    const ws = workbook.addWorksheet('Inventory Pipeline');
    ws.columns = [
      { header: 'Stock #', key: 'stock', width: 12 },
      { header: 'Vehicle', key: 'vehicle', width: 30 },
      { header: 'Customer', key: 'customer', width: 25 },
      { header: 'Salesperson', key: 'salesperson', width: 20 },
      { header: 'Vehicle Status', key: 'vStatus', width: 15 },
      { header: 'Finance Status', key: 'fStatus', width: 15 },
      { header: 'Days Old', key: 'days', width: 10 },
    ];
    ws.getRow(1).eachCell((cell) => Object.assign(cell, headerStyle));

    const now = new Date();
    deals
      .filter((d) => d.deal_status !== 'cancelled')
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .forEach((d) => {
        const days = Math.floor((now - new Date(d.created_at)) / (1000 * 60 * 60 * 24));
        ws.addRow({
          stock: d.stock_number || '',
          vehicle: [d.year, d.make, d.model].filter(Boolean).join(' '),
          customer: d.customer_name || '',
          salesperson: d.salesperson_name || '',
          vStatus: d.vehicle_status || '',
          fStatus: d.finance_status || '',
          days,
        });
      });
  }

  return workbook.xlsx.writeBuffer();
}

// ============================================================
// PDF GENERATION
// ============================================================

async function generatePDF(type, deals, commissions, period) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'LETTER' });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.fontSize(20).fillColor('#1e3a5f').text('Kia Mont-Laurier', { align: 'center' });
    doc.fontSize(12).fillColor('#666').text(`Report: ${type.charAt(0).toUpperCase() + type.slice(1)} | Period: ${period.toUpperCase()}`, { align: 'center' });
    doc.moveDown();
    doc.fontSize(8).fillColor('#999').text(`Generated: ${new Date().toLocaleString('en-CA')}`, { align: 'right' });
    doc.moveTo(40, doc.y).lineTo(572, doc.y).stroke('#1e3a5f');
    doc.moveDown();

    if (type === 'sales' || type === 'financial') {
      const totalSales = deals.reduce((s, d) => s + (Number(d.sale_price) || 0), 0);
      const totalCost = deals.reduce((s, d) => s + (Number(d.vehicle_cost) || 0), 0);
      const totalGross = totalSales - totalCost;
      const totalFI = deals.reduce((s, d) => s + (Number(d.fi_reserve) || 0), 0);

      doc.fontSize(14).fillColor('#1e3a5f').text('Summary', { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(10).fillColor('#333');
      doc.text(`Total Deals: ${deals.length}`);
      doc.text(`Total Sales: ${fmt(totalSales)}`);
      doc.text(`Total Cost: ${fmt(totalCost)}`);
      doc.text(`Gross Profit: ${fmt(totalGross)}`);
      doc.text(`F&I Reserve: ${fmt(totalFI)}`);
      doc.text(`Net Gross: ${fmt(totalGross + totalFI)}`);
      doc.moveDown();

      if (type === 'sales') {
        doc.fontSize(14).fillColor('#1e3a5f').text('Sales by Person', { underline: true });
        doc.moveDown(0.5);

        const byPerson = {};
        deals.forEach((d) => {
          const name = d.salesperson_name || 'Unknown';
          if (!byPerson[name]) byPerson[name] = { name, deals: 0, gross: 0 };
          byPerson[name].deals++;
          byPerson[name].gross += (Number(d.sale_price) || 0) - (Number(d.vehicle_cost) || 0) + (Number(d.fi_reserve) || 0);
        });

        const tableTop = doc.y;
        const colWidths = [180, 60, 120];
        // Table header
        doc.fontSize(9).fillColor('#fff');
        doc.rect(40, tableTop, 532, 18).fill('#1e3a5f');
        doc.text('Salesperson', 45, tableTop + 4, { width: colWidths[0] });
        doc.text('Deals', 225, tableTop + 4, { width: colWidths[1], align: 'center' });
        doc.text('Total Gross', 285, tableTop + 4, { width: colWidths[2], align: 'right' });

        let y = tableTop + 20;
        doc.fillColor('#333');
        Object.values(byPerson)
          .sort((a, b) => b.gross - a.gross)
          .forEach((p, i) => {
            if (y > 720) {
              doc.addPage();
              y = 40;
            }
            if (i % 2 === 0) {
              doc.rect(40, y - 2, 532, 16).fill('#f0f4f8');
              doc.fillColor('#333');
            }
            doc.fontSize(9);
            doc.text(p.name, 45, y, { width: colWidths[0] });
            doc.text(String(p.deals), 225, y, { width: colWidths[1], align: 'center' });
            doc.text(fmt(p.gross), 285, y, { width: colWidths[2], align: 'right' });
            y += 16;
          });
      }

      if (type === 'financial') {
        doc.moveDown();
        doc.fontSize(14).fillColor('#1e3a5f').text('Money Flow', { underline: true });
        doc.moveDown(0.5);
        doc.fontSize(10).fillColor('#333');

        const mdTotal = deals.reduce((s, d) => s + (Number(d.money_down_amount) || 0), 0);
        const mdCollected = deals.filter((d) => d.money_down_collected).reduce((s, d) => s + (Number(d.money_down_amount) || 0), 0);
        doc.text(`Money Down Total: ${fmt(mdTotal)}`);
        doc.text(`Money Down Collected: ${fmt(mdCollected)}`);
        doc.text(`Money Down Outstanding: ${fmt(mdTotal - mdCollected)}`);
        doc.moveDown(0.5);

        const cbTotal = deals.reduce((s, d) => s + (Number(d.cash_back_amount) || 0), 0);
        const cbSent = deals.filter((d) => d.cash_back_sent).reduce((s, d) => s + (Number(d.cash_back_amount) || 0), 0);
        doc.text(`Cash Back Total: ${fmt(cbTotal)}`);
        doc.text(`Cash Back Sent: ${fmt(cbSent)}`);
        doc.text(`Cash Back Pending: ${fmt(cbTotal - cbSent)}`);
      }
    }

    if (type === 'commissions') {
      doc.fontSize(14).fillColor('#1e3a5f').text('Commission Report', { underline: true });
      doc.moveDown(0.5);

      const byPerson = {};
      commissions.forEach((c) => {
        const name = c.salesperson_name;
        if (!byPerson[name]) byPerson[name] = { name, deals: 0, commission: 0, overrides: 0 };
        byPerson[name].deals++;
        byPerson[name].commission += Number(c.commission_amount) || 0;
      });
      commissions.forEach((c) => {
        if (c.override_salesperson && c.override_amount > 0) {
          if (!byPerson[c.override_salesperson]) byPerson[c.override_salesperson] = { name: c.override_salesperson, deals: 0, commission: 0, overrides: 0 };
          byPerson[c.override_salesperson].overrides += Number(c.override_amount) || 0;
        }
      });

      const tableTop = doc.y;
      doc.fontSize(9).fillColor('#fff');
      doc.rect(40, tableTop, 532, 18).fill('#1e3a5f');
      doc.text('Salesperson', 45, tableTop + 4, { width: 160 });
      doc.text('Deals', 205, tableTop + 4, { width: 50, align: 'center' });
      doc.text('Commission', 255, tableTop + 4, { width: 100, align: 'right' });
      doc.text('Overrides', 355, tableTop + 4, { width: 90, align: 'right' });
      doc.text('Total', 445, tableTop + 4, { width: 100, align: 'right' });

      let y = tableTop + 20;
      doc.fillColor('#333');
      Object.values(byPerson)
        .sort((a, b) => (b.commission + b.overrides) - (a.commission + a.overrides))
        .forEach((p, i) => {
          if (y > 720) { doc.addPage(); y = 40; }
          if (i % 2 === 0) {
            doc.rect(40, y - 2, 532, 16).fill('#f0f4f8');
            doc.fillColor('#333');
          }
          doc.fontSize(9);
          doc.text(p.name, 45, y, { width: 160 });
          doc.text(String(p.deals), 205, y, { width: 50, align: 'center' });
          doc.text(fmt(p.commission), 255, y, { width: 100, align: 'right' });
          doc.text(fmt(p.overrides), 355, y, { width: 90, align: 'right' });
          doc.text(fmt(p.commission + p.overrides), 445, y, { width: 100, align: 'right' });
          y += 16;
        });
    }

    if (type === 'inventory') {
      doc.fontSize(14).fillColor('#1e3a5f').text('Inventory Pipeline', { underline: true });
      doc.moveDown(0.5);

      const now = new Date();
      const active = deals.filter((d) => d.deal_status !== 'cancelled');

      doc.fontSize(10).fillColor('#333');
      doc.text(`Total Active: ${active.length}`);
      doc.text(`Incoming: ${active.filter((d) => d.vehicle_status === 'incoming').length}`);
      doc.text(`At Garage: ${active.filter((d) => d.vehicle_status === 'at_garage').length}`);
      doc.text(`Delivered: ${active.filter((d) => d.vehicle_status === 'delivered').length}`);
      doc.moveDown();

      // Aging list
      const aging = active
        .filter((d) => d.vehicle_status !== 'delivered')
        .map((d) => ({
          stock: d.stock_number || '-',
          vehicle: [d.year, d.make, d.model].filter(Boolean).join(' '),
          days: Math.floor((now - new Date(d.created_at)) / (1000 * 60 * 60 * 24)),
          status: d.vehicle_status,
        }))
        .sort((a, b) => b.days - a.days);

      if (aging.length > 0) {
        doc.fontSize(12).fillColor('#1e3a5f').text('Aging Inventory', { underline: true });
        doc.moveDown(0.5);

        const tableTop = doc.y;
        doc.fontSize(9).fillColor('#fff');
        doc.rect(40, tableTop, 532, 18).fill('#1e3a5f');
        doc.text('Stock #', 45, tableTop + 4, { width: 80 });
        doc.text('Vehicle', 125, tableTop + 4, { width: 200 });
        doc.text('Status', 325, tableTop + 4, { width: 100 });
        doc.text('Days', 445, tableTop + 4, { width: 80, align: 'right' });

        let y = tableTop + 20;
        doc.fillColor('#333');
        aging.forEach((a, i) => {
          if (y > 720) { doc.addPage(); y = 40; }
          if (i % 2 === 0) {
            doc.rect(40, y - 2, 532, 16).fill('#f0f4f8');
            doc.fillColor('#333');
          }
          doc.fontSize(9);
          doc.text(a.stock, 45, y, { width: 80 });
          doc.text(a.vehicle, 125, y, { width: 200 });
          doc.text(a.status, 325, y, { width: 100 });
          doc.text(String(a.days), 445, y, { width: 80, align: 'right' });
          y += 16;
        });
      }
    }

    doc.end();
  });
}

module.exports = { generateExcel, generatePDF };

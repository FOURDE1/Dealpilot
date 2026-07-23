require('dotenv').config();
const supabase = require('./middleware/supabase');

const deals = [
  {
    stock_number: 'U-1001', vin: '5XYZ34AB5PG100001', year: 2024, make: 'Kia', model: 'Sportage LX', color: 'Snow White Pearl',
    vehicle_source: 'Factory Order', vehicle_status: 'at_garage', sale_type: 'retail', listed_online: true, is_sourced_unit: false,
    customer_name: 'Jean-Pierre Tremblay', customer_phone: '819-555-2341', customer_address: '145 Rue de la Madone, Mont-Laurier, QC J9L 1S3',
    salesperson_name: 'Jason Chahine', financing_bank: 'Desjardins', finance_status: 'approved',
    money_down_amount: 3000, money_down_collected: true, cash_back_amount: 500, cash_back_sent: false,
    accessories: 'All-weather mats, cargo tray', native_status: false,
    sale_price: 36500, vehicle_cost: 30200, fi_reserve: 1400,
    tentative_delivery_date: '2026-04-07', delivery_date: null, driver_booked_date: '2026-04-07T10:00:00',
    chaser_vehicle_info: 'Supreme Transport - White Honda Civic', pickup_location: 'Kia Mont-Laurier',
    delivery_address: '145 Rue de la Madone, Mont-Laurier, QC J9L 1S3',
    licensing_province: 'quebec', licensing_completed: true, photos_taken: false, wet_ink_signed: false, idv_completed: false,
    has_trade_in: true, trade_year: 2019, trade_make: 'Honda', trade_model: 'Civic LX', trade_color: 'Silver',
    trade_vin: '2HGFC2F59KH501234', trade_stock_number: 'T-501', has_lien: true, lien_bank: 'Desjardins', lien_amount: 6800,
    is_sold: false, deal_status: 'open', has_cosigner: false,
  },
  {
    stock_number: 'U-1002', vin: '5XYZ34AB7PG200002', year: 2025, make: 'Kia', model: 'Sorento SX', color: 'Midnight Black',
    vehicle_source: 'Dealer Trade', vehicle_status: 'incoming', sale_type: 'retail', listed_online: false, is_sourced_unit: false,
    customer_name: 'Marie-Claude Leblanc', customer_phone: '819-555-8876', customer_address: '320 Boul. Albiny-Paquette, Mont-Laurier, QC J9L 1M5',
    salesperson_name: 'Ibrahim Hussain', financing_bank: 'TD Auto Finance', finance_status: 'pending',
    money_down_amount: 5000, money_down_collected: false, cash_back_amount: 0, cash_back_sent: false,
    accessories: 'Roof rack, tow hitch', native_status: false,
    sale_price: 52000, vehicle_cost: 43500, fi_reserve: 2100,
    tentative_delivery_date: '2026-04-10', delivery_date: null, driver_booked_date: '2026-04-10T14:00:00',
    chaser_vehicle_info: "Denise's Guys - Grey Toyota Corolla", pickup_location: 'Kia Gatineau (Dealer Trade)',
    delivery_address: '320 Boul. Albiny-Paquette, Mont-Laurier, QC J9L 1M5',
    licensing_province: 'quebec', licensing_completed: false, photos_taken: false, wet_ink_signed: false, idv_completed: false,
    has_trade_in: false, is_sold: false, deal_status: 'open', has_cosigner: false,
  },
  {
    stock_number: 'U-1003', vin: '5XYZ34AB9PG300003', year: 2024, make: 'Kia', model: 'Forte GT', color: 'Gravity Grey',
    vehicle_source: 'Factory Order', vehicle_status: 'delivered', sale_type: 'retail', listed_online: true, is_sourced_unit: false,
    customer_name: 'Ahmed Benali', customer_phone: '613-555-3344', customer_address: '87 Bank Street, Ottawa, ON K1P 5N2',
    salesperson_name: 'Hussein Alshawi', financing_bank: 'BMO', finance_status: 'funded',
    money_down_amount: 2000, money_down_collected: true, cash_back_amount: 1000, cash_back_sent: true,
    accessories: 'Sunroof visor', native_status: false,
    sale_price: 29800, vehicle_cost: 24500, fi_reserve: 900,
    tentative_delivery_date: '2026-04-01', delivery_date: '2026-04-02T11:30:00', driver_booked_date: '2026-04-01T09:00:00',
    chaser_vehicle_info: 'Supreme Transport - Blue Kia Forte', pickup_location: 'Kia Mont-Laurier',
    delivery_address: '87 Bank Street, Ottawa, ON K1P 5N2',
    licensing_province: 'ontario', licensing_completed: true, photos_taken: true, wet_ink_signed: true, idv_completed: true,
    has_trade_in: false, is_sold: true, sold_type: 'retail', deal_status: 'complete', has_cosigner: false,
  },
  {
    stock_number: 'U-1004', vin: '5XYZ34AB1PG400004', year: 2025, make: 'Kia', model: 'Carnival SX', color: 'Aurora Black Pearl',
    vehicle_source: 'Factory Order', vehicle_status: 'at_garage', sale_type: 'retail', listed_online: true, is_sourced_unit: false,
    customer_name: 'Fatima Bouchard-Nasser', customer_phone: '819-555-7712', customer_address: '56 Rue du Pont, Mont-Laurier, QC J9L 2R8',
    salesperson_name: 'Hassan Alabboudy', financing_bank: 'RBC', finance_status: 'approved',
    money_down_amount: 8000, money_down_collected: true, cash_back_amount: 750, cash_back_sent: false,
    accessories: 'All-weather mats, rear entertainment, cargo net', native_status: false,
    sale_price: 58000, vehicle_cost: 48000, fi_reserve: 2500,
    tentative_delivery_date: '2026-04-08', delivery_date: null, driver_booked_date: '2026-04-08T13:00:00',
    chaser_vehicle_info: 'Supreme Transport - White Honda Civic', pickup_location: 'Kia Mont-Laurier',
    delivery_address: '56 Rue du Pont, Mont-Laurier, QC J9L 2R8',
    licensing_province: 'quebec', licensing_completed: true, photos_taken: false, wet_ink_signed: false, idv_completed: false,
    has_trade_in: true, trade_year: 2020, trade_make: 'Toyota', trade_model: 'Sienna LE', trade_color: 'Grey',
    trade_vin: '5TDYZ3DC0LS012345', trade_stock_number: 'T-502', has_lien: false, lien_amount: 0,
    is_sold: false, deal_status: 'open', has_cosigner: true, cosigner_name: 'Karim Nasser',
  },
  {
    stock_number: 'U-1005', vin: '5XYZ34AB3PG500005', year: 2024, make: 'Kia', model: 'Seltos EX', color: 'Starbright Yellow',
    vehicle_source: 'Dealer Trade', vehicle_status: 'at_garage', sale_type: 'retail', listed_online: false, is_sourced_unit: false,
    customer_name: 'Robert Gagnon', customer_phone: '819-555-1199', customer_address: '233 Chemin de la Lièvre, Mont-Laurier, QC J9L 3G1',
    salesperson_name: 'Omar Mohamed', financing_bank: 'Scotia', finance_status: 'funded',
    money_down_amount: 1500, money_down_collected: true, cash_back_amount: 0, cash_back_sent: false,
    accessories: '', native_status: false,
    sale_price: 31000, vehicle_cost: 26000, fi_reserve: 1100,
    tentative_delivery_date: '2026-04-05', delivery_date: null, driver_booked_date: '2026-04-05T10:30:00',
    chaser_vehicle_info: "Denise's Guys - Black Hyundai Elantra", pickup_location: 'Kia Ottawa (Dealer Trade)',
    delivery_address: '233 Chemin de la Lièvre, Mont-Laurier, QC J9L 3G1',
    licensing_province: 'quebec', licensing_completed: true, photos_taken: false, wet_ink_signed: false, idv_completed: true,
    has_trade_in: false, is_sold: false, deal_status: 'open', has_cosigner: false,
  },
  {
    stock_number: 'U-1006', vin: '5XYZ34AB5PG600006', year: 2025, make: 'Kia', model: 'Sportage X-Line', color: 'Dawning Red',
    vehicle_source: 'Factory Order', vehicle_status: 'incoming', sale_type: 'retail', listed_online: true, is_sourced_unit: false,
    customer_name: 'Sophie Lavoie-Patel', customer_phone: '613-555-6632', customer_address: '12 Elgin Street, Ottawa, ON K1P 5K8',
    salesperson_name: 'Muhammad Majid Hassan', financing_bank: 'Desjardins', finance_status: 'pending',
    money_down_amount: 4000, money_down_collected: false, cash_back_amount: 500, cash_back_sent: false,
    accessories: 'Mud guards, block heater', native_status: false,
    sale_price: 41500, vehicle_cost: 34000, fi_reserve: 1600,
    tentative_delivery_date: '2026-04-14', delivery_date: null, driver_booked_date: '2026-04-14T09:00:00',
    chaser_vehicle_info: 'Supreme Transport - Silver Nissan Sentra', pickup_location: 'Kia Mont-Laurier',
    delivery_address: '12 Elgin Street, Ottawa, ON K1P 5K8',
    licensing_province: 'ontario', licensing_completed: false, photos_taken: false, wet_ink_signed: false, idv_completed: false,
    has_trade_in: false, is_sold: false, deal_status: 'open', has_cosigner: false,
  },
  {
    stock_number: 'U-1007', vin: '5XYZ34AB7PG700007', year: 2024, make: 'Kia', model: 'Forte LX', color: 'Clear White',
    vehicle_source: 'Lease Return', vehicle_status: 'delivered', sale_type: 'retail', listed_online: true, is_sourced_unit: false,
    customer_name: 'Pierre Cote', customer_phone: '819-555-4478', customer_address: '78 Rue Limoges, Mont-Laurier, QC J9L 1H2',
    salesperson_name: 'Nicolas Sayah', financing_bank: 'TD Auto Finance', finance_status: 'funded',
    money_down_amount: 0, money_down_collected: false, cash_back_amount: 0, cash_back_sent: false,
    accessories: '', native_status: false,
    sale_price: 24500, vehicle_cost: 19800, fi_reserve: 700,
    tentative_delivery_date: '2026-03-28', delivery_date: '2026-03-29T15:00:00', driver_booked_date: '2026-03-28T14:00:00',
    chaser_vehicle_info: "Denise's Guys - Grey Toyota Corolla", pickup_location: 'Kia Mont-Laurier',
    delivery_address: '78 Rue Limoges, Mont-Laurier, QC J9L 1H2',
    licensing_province: 'quebec', licensing_completed: true, photos_taken: true, wet_ink_signed: true, idv_completed: true,
    has_trade_in: false, is_sold: true, sold_type: 'retail', deal_status: 'complete', has_cosigner: false,
  },
  {
    stock_number: 'U-1008', vin: '5XYZ34AB9PG800008', year: 2025, make: 'Kia', model: 'Sorento PHEV', color: 'Glacial White Pearl',
    vehicle_source: 'Factory Order', vehicle_status: 'at_garage', sale_type: 'retail', listed_online: true, is_sourced_unit: false,
    customer_name: 'Nadia Bergeron', customer_phone: '819-555-3356', customer_address: '401 Boul. des Ruisseaux, Mont-Laurier, QC J9L 3M4',
    salesperson_name: 'Hussain Safa', financing_bank: 'BMO', finance_status: 'approved',
    money_down_amount: 6000, money_down_collected: true, cash_back_amount: 1200, cash_back_sent: false,
    accessories: 'Tow hitch, cargo cover, all-weather mats', native_status: false,
    sale_price: 55000, vehicle_cost: 46000, fi_reserve: 2200,
    tentative_delivery_date: '2026-04-09', delivery_date: null, driver_booked_date: '2026-04-09T11:00:00',
    chaser_vehicle_info: 'Supreme Transport - White Honda Civic', pickup_location: 'Kia Mont-Laurier',
    delivery_address: '401 Boul. des Ruisseaux, Mont-Laurier, QC J9L 3M4',
    licensing_province: 'quebec', licensing_completed: false, photos_taken: false, wet_ink_signed: false, idv_completed: false,
    has_trade_in: true, trade_year: 2021, trade_make: 'Kia', trade_model: 'Sportage LX', trade_color: 'Black',
    trade_vin: '5XYP34AB1MG678901', trade_stock_number: 'T-503', has_lien: true, lien_bank: 'BMO', lien_amount: 12500,
    is_sold: false, deal_status: 'open', has_cosigner: false,
  },
  {
    stock_number: 'U-1009', vin: '5XYZ34AB1PG900009', year: 2024, make: 'Kia', model: 'Seltos SX Turbo', color: 'Pluton Blue',
    vehicle_source: 'Auction', vehicle_status: 'delivered', sale_type: 'wholesale', listed_online: false, is_sourced_unit: false,
    customer_name: 'Luc Pelletier Auto Inc.', customer_phone: '819-555-9901', customer_address: '890 Rue Principale, Riviere-Rouge, QC J0T 1T0',
    salesperson_name: 'Abdul-Alla Al-Ubeedi', financing_bank: 'RBC', finance_status: 'funded',
    money_down_amount: 0, money_down_collected: false, cash_back_amount: 0, cash_back_sent: false,
    accessories: '', native_status: false,
    sale_price: 27000, vehicle_cost: 21000, fi_reserve: 0,
    tentative_delivery_date: '2026-03-31', delivery_date: '2026-04-01T08:00:00', driver_booked_date: '2026-03-31T07:30:00',
    chaser_vehicle_info: 'Self-pickup by buyer', pickup_location: 'Kia Mont-Laurier',
    delivery_address: '890 Rue Principale, Riviere-Rouge, QC J0T 1T0',
    licensing_province: 'quebec', licensing_completed: true, photos_taken: true, wet_ink_signed: true, idv_completed: true,
    has_trade_in: false, is_sold: true, sold_type: 'wholesale', deal_status: 'complete', has_cosigner: false,
  },
  {
    stock_number: 'U-1010', vin: '5XYZ34AB3PGA10010', year: 2025, make: 'Kia', model: 'EV6 GT-Line', color: 'Yacht Blue',
    vehicle_source: 'Factory Order', vehicle_status: 'incoming', sale_type: 'retail', listed_online: true, is_sourced_unit: false,
    customer_name: 'Isabelle Fortin-Saad', customer_phone: '613-555-2278', customer_address: '55 Sparks Street, Ottawa, ON K1P 5A5',
    salesperson_name: 'Michael Belway', financing_bank: 'Scotia', finance_status: 'pending',
    money_down_amount: 10000, money_down_collected: true, cash_back_amount: 2000, cash_back_sent: false,
    accessories: 'Home charger install, all-weather mats, paint protection film', native_status: false,
    sale_price: 62000, vehicle_cost: 52000, fi_reserve: 1800,
    tentative_delivery_date: '2026-04-18', delivery_date: null, driver_booked_date: '2026-04-18T10:00:00',
    chaser_vehicle_info: "Denise's Guys - Black Hyundai Elantra", pickup_location: 'Kia Distribution Centre, Montreal',
    delivery_address: '55 Sparks Street, Ottawa, ON K1P 5A5',
    licensing_province: 'ontario', licensing_completed: false, photos_taken: false, wet_ink_signed: false, idv_completed: false,
    has_trade_in: true, trade_year: 2022, trade_make: 'Tesla', trade_model: 'Model 3 SR+', trade_color: 'White',
    trade_vin: '5YJ3E1EA1NF123456', trade_stock_number: 'T-504', has_lien: true, lien_bank: 'Scotia', lien_amount: 18000,
    is_sold: false, deal_status: 'open', has_cosigner: false,
  },
];

async function run() {
  // Delete old test deals first
  const { data: old } = await supabase.from('deals').select('id, stock_number')
    .in('stock_number', ['7000','7001','7002','7003','7004','7005','7006','7007','7008','7009',
      'U-1001','U-1002','U-1003','U-1004','U-1005','U-1006','U-1007','U-1008','U-1009','U-1010']);
  if (old && old.length > 0) {
    const ids = old.map(d => d.id);
    await supabase.from('delivery_checklists').delete().in('deal_id', ids);
    await supabase.from('commissions').delete().in('deal_id', ids);
    await supabase.from('deals').delete().in('id', ids);
    console.log('Cleaned up ' + old.length + ' old test deals');
  }

  for (let i = 0; i < deals.length; i++) {
    const d = deals[i];
    const { data, error } = await supabase.from('deals').insert(d).select().single();
    if (error) { console.error(d.stock_number + ': ' + error.message); continue; }

    // Create delivery checklist
    const isDelivered = d.vehicle_status === 'delivered';
    const company = d.chaser_vehicle_info.includes('Supreme') ? 'supreme' : d.chaser_vehicle_info.includes('Denise') ? 'denises_guys' : null;
    const driverName = company === 'supreme' ? 'Supreme Transport' : company === 'denises_guys' ? "Denise's Guys" : 'Self-pickup';

    await supabase.from('delivery_checklists').upsert({
      deal_id: data.id,
      client_insurance_uploaded: isDelivered || i === 0 || i === 3 || i === 4,
      deal_funded: d.finance_status === 'funded',
      safety_done: isDelivered || i === 0 || i === 3,
      registration_done: isDelivered || i === 4,
      drivers_booked: true,
      driver_names: driverName,
      booking_company: company,
      booked_delivery_time: d.driver_booked_date,
      chaser_car_required: !d.has_trade_in,
      chaser_car_booked: !d.has_trade_in,
      dealer_plate_required: true,
      dealer_plate_assigned: 'D-' + (100 + i),
    }, { onConflict: 'deal_id' });

    console.log((i + 1) + '. ' + d.stock_number + ' ' + d.year + ' ' + d.make + ' ' + d.model + ' — ' + d.customer_name + (isDelivered ? ' [DELIVERED]' : ''));
  }

  console.log('\nDone! 10 deals with delivery checklists created.');
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });

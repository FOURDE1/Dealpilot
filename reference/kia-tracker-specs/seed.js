require('./server/node_modules/dotenv').config({ path: './server/.env' });
const { createClient } = require('./server/node_modules/@supabase/supabase-js');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('seed.js: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in server/.env');
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const makes = ['Kia', 'Kia', 'Kia', 'Kia', 'Hyundai', 'Hyundai', 'Toyota', 'Honda', 'Ford', 'Chevrolet'];
const kiaModels = ['Forte', 'Seltos', 'Sportage', 'Sorento', 'Telluride', 'Soul', 'K5', 'Carnival', 'Niro', 'EV6', 'EV9'];
const hyundaiModels = ['Elantra', 'Tucson', 'Santa Fe', 'Kona', 'Ioniq 5', 'Palisade'];
const toyotaModels = ['Corolla', 'RAV4', 'Camry', 'Highlander'];
const hondaModels = ['Civic', 'CR-V', 'Accord', 'HR-V'];
const fordModels = ['Escape', 'Explorer', 'F-150', 'Bronco'];
const chevModels = ['Equinox', 'Silverado', 'Malibu', 'Trax'];
const colors = ['White', 'Black', 'Silver', 'Red', 'Blue', 'Grey', 'Green', 'Pearl White', 'Midnight Blue', 'Snow White Pearl'];
const salespersons = ['Hassan', 'Jason', 'Steve', 'Marc', 'Sophie', 'Luc'];
const banks = ['TD Auto', 'Scotiabank', 'BMO', 'RBC', 'Desjardins', 'National Bank', 'CIBC', 'Cash Deal'];
const sources = ['Auction', 'Trade-In', 'Dealer Trade', 'Lease Return', 'Factory Order', 'Consignment'];
const provinces = ['ontario', 'quebec', 'other'];
const vStatuses = ['incoming', 'at_garage', 'delivered'];
const fStatuses = ['pending', 'approved', 'funded'];
const saleTypes = ['retail', 'wholesale'];
const firstNames = ['Jean', 'Pierre', 'Marie', 'Sophie', 'Michel', 'Claude', 'Robert', 'Sylvie', 'Daniel', 'Marc', 'Luc', 'Anne', 'Paul', 'Julie', 'Eric', 'Nathalie', 'David', 'Caroline', 'Martin', 'Isabelle', 'James', 'John', 'Sarah', 'Mike', 'Emily'];
const lastNames = ['Tremblay', 'Gagnon', 'Roy', 'Cote', 'Bouchard', 'Gauthier', 'Morin', 'Lavoie', 'Fortin', 'Pelletier', 'Belanger', 'Levesque', 'Bergeron', 'Leblanc', 'Paquette', 'Smith', 'Johnson', 'Brown', 'Wilson', 'Taylor'];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function getModel(make) {
  if (make === 'Kia') return pick(kiaModels);
  if (make === 'Hyundai') return pick(hyundaiModels);
  if (make === 'Toyota') return pick(toyotaModels);
  if (make === 'Honda') return pick(hondaModels);
  if (make === 'Ford') return pick(fordModels);
  if (make === 'Chevrolet') return pick(chevModels);
  return 'Unknown';
}

const deals = [];
for (let i = 0; i < 50; i++) {
  const make = pick(makes);
  const model = getModel(make);
  const year = rand(2022, 2026);
  const vStatus = pick(vStatuses);
  const fStatus = pick(fStatuses);
  const saleType = pick(saleTypes);
  const hasTrade = Math.random() > 0.6;
  const hasLien = hasTrade && Math.random() > 0.5;
  const hasCosigner = Math.random() > 0.75;
  const isSold = vStatus === 'delivered' && fStatus === 'funded';
  const dealStatus = isSold ? (Math.random() > 0.3 ? 'complete' : 'open') : 'open';
  const listedOnline = Math.random() > 0.3;

  const deliveryDate = new Date();
  deliveryDate.setDate(deliveryDate.getDate() + rand(-10, 30));

  const driverBooked = vStatus === 'delivered' || Math.random() > 0.5;
  const driverDate = new Date();
  driverDate.setDate(driverDate.getDate() + rand(-5, 20));

  const tradeMake = pick(['Toyota', 'Honda', 'Hyundai', 'Kia', 'Ford', 'Chevrolet', 'Nissan']);

  deals.push({
    deal_status: dealStatus,
    stock_number: 'STK' + rand(10000, 99999),
    vin: 'KNA' + rand(1000000, 9999999) + rand(10000, 99999),
    year,
    make,
    model,
    color: pick(colors),
    vehicle_source: pick(sources),
    vehicle_status: vStatus,
    sale_type: saleType,
    listed_online: listedOnline,
    customer_name: pick(firstNames) + ' ' + pick(lastNames),
    customer_address: rand(100, 9999) + ' Rue ' + pick(['Principale', 'du Lac', 'de la Montagne', 'Bellevue', 'Saint-Jean', 'Lafleur', 'des Pins', 'du Parc']),
    customer_phone: '819-' + rand(200, 999) + '-' + rand(1000, 9999),
    has_cosigner: hasCosigner,
    cosigner_name: hasCosigner ? pick(firstNames) + ' ' + pick(lastNames) : null,
    salesperson_name: pick(salespersons),
    financing_bank: pick(banks),
    finance_status: fStatus,
    money_down_amount: pick([0, 500, 1000, 1500, 2000, 2500, 3000, 5000]),
    money_down_collected: fStatus === 'funded' ? true : Math.random() > 0.5,
    cash_back_amount: pick([0, 0, 0, 500, 750, 1000, 1500, 2000]),
    cash_back_sent: Math.random() > 0.6,
    accessories: pick(['Floor mats, mud flaps', 'Tinted windows', 'Remote starter, roof rack', 'None', 'Block heater, cargo tray', 'Paint protection, undercoat', 'Winter tires + rims', 'Trailer hitch']),
    native_status: Math.random() > 0.85,
    delivery_date: deliveryDate.toISOString(),
    driver_booked_date: driverBooked ? driverDate.toISOString() : null,
    chaser_vehicle_info: pick(['White Kia Soul', 'Black Hyundai Tucson', 'Silver Kia Sportage', 'N/A', 'Red Kia Forte', null]),
    pickup_location: pick(['Mont-Laurier Lot', 'Ottawa Auction', 'Montreal Port', 'Toronto Hub', 'Gatineau Depot', 'Manheim Montreal']),
    delivery_address: rand(100, 9999) + ' ' + pick(['Rue Principale', 'Boul. Albiny-Paquette', 'Rue de la Madone', 'Ch. du Lac', 'Rue Hebert']) + ', Mont-Laurier, QC',
    licensing_province: pick(provinces),
    licensing_completed: Math.random() > 0.4,
    photos_taken: vStatus === 'delivered' ? true : Math.random() > 0.6,
    wet_ink_signed: vStatus === 'delivered' ? true : Math.random() > 0.5,
    idv_completed: Math.random() > 0.4,
    has_trade_in: hasTrade,
    trade_year: hasTrade ? rand(2015, 2023) : null,
    trade_make: hasTrade ? tradeMake : null,
    trade_model: hasTrade ? pick(['Civic', 'RAV4', 'Elantra', 'Forte', 'Escape', 'Equinox', 'Sentra', 'CR-V']) : null,
    trade_color: hasTrade ? pick(colors) : null,
    trade_plate: hasTrade ? pick(['BXRT', 'AMNP', 'CDKL', 'FGHJ']) + ' ' + rand(100, 999) : null,
    trade_vin: hasTrade ? 'JHM' + rand(1000000, 9999999) + rand(10000, 99999) : null,
    trade_stock_number: hasTrade ? 'TRD' + rand(10000, 99999) : null,
    has_lien: hasLien,
    lien_bank: hasLien ? pick(['TD', 'Scotiabank', 'Desjardins', 'RBC', 'BMO']) : null,
    lien_amount: hasLien ? pick([5000, 8000, 12000, 15000, 18000, 22000]) : 0,
    is_sold: isSold,
    sold_type: isSold ? saleType : null,
  });
}

async function insert() {
  const { data, error } = await supabase.from('deals').insert(deals).select('id');
  if (error) {
    console.log('ERROR:', error.message);
  } else {
    console.log('Inserted ' + data.length + ' test deals');
  }
}
insert();

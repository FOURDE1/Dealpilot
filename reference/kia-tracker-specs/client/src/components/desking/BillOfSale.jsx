import { useTranslation } from 'react-i18next';
import { formatCurrency } from '../../utils/billOfSale';
import './billOfSaleStyles.css';

function money(v) { return formatCurrency(Number(v) || 0); }

function Row({ label, value, bold, grand, blank }) {
  if (blank) return <tr className="bos-blank-row"><td>&nbsp;</td><td>&nbsp;</td></tr>;
  return (
    <tr className={grand ? 'bos-pp-grand' : bold ? 'bos-pp-total' : 'bos-pp-row'}>
      <td>{label}</td>
      <td className="bos-right">{value}</td>
    </tr>
  );
}

function LabelCell({ label, value, wide }) {
  return (
    <td style={wide ? { width: '50%' } : undefined}>
      <span className="bos-label">{label}:</span> {value || '\u00a0'}
    </td>
  );
}

export default function BillOfSale({ data }) {
  const { t } = useTranslation();
  if (!data) return null;

  const customer   = data?.customer   || {};
  const vehicle    = data?.vehicle    || {};
  const pricing    = data?.pricing    || {};
  const financing  = data?.financing  || {};
  const dealership = data?.dealership || {};
  const products   = data?.products   || {};
  const trades     = Array.isArray(data?.trades) ? data.trades : [];
  const fees       = Array.isArray(pricing?.fees) ? pricing.fees : [];
  const fiProducts = Array.isArray(pricing?.fiProducts) ? pricing.fiProducts : [];
  const taxExempt  = !!data?.taxExempt;

  const isUsed = (vehicle?.condition || '').toLowerCase() === 'used';
  const fiExcludingWarranty = fiProducts.filter((p) => p?.id !== 'ext-warranty');

  return (
    <div id="bill-of-sale-root">
      {/* ================= HEADER ================= */}
      <div className="bos-title">{t('desking.vehiclePurchaseAgreement')}</div>
      <table className="bos-table" style={{ marginBottom: 6 }}>
        <tbody>
          <tr>
            <td style={{ width: '65%' }}>
              <div className="bos-dealer-name">{dealership.name}</div>
              <div className="bos-dealer-line">{dealership.address || '\u00a0'}</div>
              <div className="bos-dealer-line">{dealership.cityProv || '\u00a0'}</div>
              <div className="bos-dealer-line">
                {dealership.phone ? `Tel: ${dealership.phone}` : ''}
                {dealership.hst ? `  HST #: ${dealership.hst}` : ''}
                {dealership.dealerReg ? `  Reg #: ${dealership.dealerReg}` : ''}
              </div>
            </td>
            <td style={{ width: '35%' }}>
              <div><span className="bos-label">Date:</span> {data.date}</div>
              <div style={{ marginTop: 4 }}>
                <span className="bos-label">Delivery Date:</span> {data.deliveryDate || '\u00a0'}
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      {/* ================= PURCHASER ================= */}
      <table className="bos-table">
        <tbody>
          <tr className="bos-section-dark"><td colSpan={2}>{t('desking.purchaser')}</td></tr>
          <tr>
            <LabelCell label={t('desking.purchaser')} value={customer.name} wide />
            <LabelCell label={t('desking.cobuyer')} value={customer.cobuyer} wide />
          </tr>
          <tr>
            <LabelCell label="Address" value={customer.address} />
            <LabelCell label="City" value={customer.city} />
          </tr>
          <tr>
            <LabelCell label="Postal" value={customer.postalCode} />
            <LabelCell label="Province" value={customer.province} />
          </tr>
          <tr>
            <LabelCell label="Driver License" value={customer.driverLicense} />
            <LabelCell label="Res. Phone" value={customer.phone} />
          </tr>
          <tr>
            <LabelCell label="Cell Phone" value={customer.cellPhone} />
            <LabelCell label="Email" value={customer.email} />
          </tr>
          <tr>
            <td><span className="bos-label">Insurance Co.:</span> &nbsp;</td>
            <td>
              <span className="bos-label">Policy No:</span> &nbsp;&nbsp;&nbsp;
              <span className="bos-label">Exp:</span> &nbsp;
            </td>
          </tr>
          <tr>
            <LabelCell label="Agent" value="" />
            <LabelCell label="Agent Phone" value="" />
          </tr>
        </tbody>
      </table>

      <div className="bos-italic-intro">
        I, THE PURCHASER, AGREE TO PURCHASE THE FOLLOWING VEHICLE FROM YOU, THE DEALER, ON THE TERMS SET OUT ON THE FRONT AND BACK OF THIS PAGE AND ALL ATTACHMENTS.
      </div>

      {/* ================= VEHICLE DESCRIPTION ================= */}
      <table className="bos-table">
        <tbody>
          <tr className="bos-section-gray"><td colSpan={4}>{t('desking.vehicleDescription')}</td></tr>
          <tr>
            <LabelCell label="Condition" value={vehicle.condition} />
            <LabelCell label="Year" value={vehicle.year} />
            <LabelCell label="Make" value={vehicle.make} />
            <LabelCell label="Model" value={vehicle.model} />
          </tr>
          <tr>
            <LabelCell label="Color" value={vehicle.color} />
            <LabelCell label="Style / Trim" value={vehicle.trim} />
            <LabelCell label="Stock #" value={vehicle.stockNumber} />
            <td style={{ fontFamily: 'monospace', fontSize: '8.5px' }}>
              <span className="bos-label">VIN:</span> {vehicle.vin || '\u00a0'}
            </td>
          </tr>
          <tr>
            <td colSpan={3}>
              <span className="bos-label">Distance Travelled On Delivery:</span> {vehicle.mileage ? vehicle.mileage.toLocaleString() : ''} Km.
            </td>
            <LabelCell label="Lic. No" value="" />
          </tr>
          <tr>
            <td colSpan={4} className="bos-right">
              <span className="bos-label">Purchaser's Initials:</span> ________
            </td>
          </tr>
        </tbody>
      </table>

      {/* ============== 2-COLUMN SPLIT: GUARANTY + PURCHASE PRICE ============== */}
      <table className="bos-table" style={{ marginTop: 4, tableLayout: 'fixed' }}>
        <tbody>
          <tr>
            {/* LEFT */}
            <td style={{ width: '48%', padding: 0, verticalAlign: 'top' }}>
              <table className="bos-table" style={{ border: 'none' }}>
                <tbody>
                  <tr className="bos-section-gray"><td colSpan={2}>{t('desking.dealerGuaranty')}</td></tr>
                  <tr>
                    <td style={{ width: '50%' }}>_____ DAYS OR</td>
                    <td>_____ KMs, whichever comes first</td>
                  </tr>
                  <tr>
                    <td colSpan={2}><span className="bos-label">Description:</span> &nbsp;</td>
                  </tr>
                </tbody>
              </table>

              {isUsed && (
                <table className="bos-table" style={{ borderTop: 'none' }}>
                  <tbody>
                    <tr className="bos-section-gray">
                      <td>
                        VEHICLE SOLD "AS IS" &nbsp;&nbsp;
                        <span style={{ fontWeight: 400 }}>Purchaser's Initials: ____</span>
                      </td>
                    </tr>
                    <tr>
                      <td className="bos-disclaimer">
                        The motor vehicle sold under this contract is being sold "as-is" and is not
                        represented as being in road-worthy condition, mechanically sound, or maintained
                        at any guaranteed level of quality. The vehicle may not be fit for use as a means
                        of transportation and may require substantial repairs at the purchaser's expense.
                        It may not be possible to register the vehicle to be driven in its current condition.
                      </td>
                    </tr>
                  </tbody>
                </table>
              )}

              <table className="bos-table" style={{ borderTop: 'none' }}>
                <tbody>
                  <tr className="bos-section-gray"><td colSpan={2}>Third Party Warranty</td></tr>
                  <tr>
                    <td style={{ width: '30%' }}><span className="bos-label">Company:</span></td>
                    <td>&nbsp;</td>
                  </tr>
                  <tr>
                    <td><span className="bos-label">Period / Descr.:</span></td>
                    <td>&nbsp;</td>
                  </tr>
                </tbody>
              </table>

              <table className="bos-table" style={{ borderTop: 'none' }}>
                <tbody>
                  <tr className="bos-section-gray"><td>{t('desking.financingInfo')}</td></tr>
                  <tr>
                    <td className="bos-disclaimer">
                      Customer has received the financing disclosure statement from the lending institution.
                      Will the dealer or sales person receive any incentive for the financing of this vehicle?
                      &nbsp;&nbsp; Yes [ &nbsp; ] &nbsp; No [ &nbsp; ] &nbsp;&nbsp;
                      <span className="bos-label">Purchaser's Initials:</span> ____
                    </td>
                  </tr>
                </tbody>
              </table>

              <table className="bos-table" style={{ borderTop: 'none' }}>
                <tbody>
                  <tr className="bos-section-gray"><td>{t('desking.tradeInDescriptions')}</td></tr>
                  <tr>
                    <td className="bos-disclaimer">
                      Is there a lien against this vehicle? (Yes or No) ______<br />
                      (see attached document)<br /><br />
                      <span className="bos-label">GST Registration:</span> ____________ &nbsp;&nbsp;
                      <span className="bos-label">Signature:</span> ____________
                    </td>
                  </tr>
                  {trades.length > 0 && (
                    <tr>
                      <td style={{ padding: 0 }}>
                        <table className="bos-table bos-tight" style={{ border: 'none' }}>
                          <thead>
                            <tr>
                              <th>Year</th><th>Make/Model</th><th>VIN</th>
                              <th className="bos-right">Allowance</th>
                              <th className="bos-right">Lien</th>
                            </tr>
                          </thead>
                          <tbody>
                            {trades.map((tr, i) => (
                              <tr key={i}>
                                <td>{tr?.year}</td>
                                <td>{tr?.make} {tr?.model}</td>
                                <td style={{ fontFamily: 'monospace', fontSize: '8px' }}>{tr?.vin}</td>
                                <td className="bos-right">{money(tr?.allowance)}</td>
                                <td className="bos-right">{money(tr?.lien)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </td>

            {/* RIGHT — Purchase Price & Payment */}
            <td style={{ width: '52%', padding: 0, verticalAlign: 'top' }}>
              <table className="bos-table" style={{ border: 'none' }}>
                <tbody>
                  <tr className="bos-section-dark"><td colSpan={2}>{t('desking.purchasePriceAndPayment')}</td></tr>
                  <Row label={t('desking.totalSalePrice')} value={money(pricing.salePrice)} />
                  <Row label={t('desking.omvicFee')} value={money(pricing.omvicFee)} />
                  <Row blank />
                  <Row label={t('desking.extendedWarranty')} value={money(pricing.extWarranty)} />
                  <Row blank />
                  <Row label={t('desking.totalVehiclePrice')} value={money(pricing.totalVehiclePrice)} bold />
                  <Row label={t('desking.tradeInAllowance')} value={`(${money(pricing.tradeAllowance)})`} />
                  <Row blank />
                  <Row label={t('desking.totalVehiclePriceLessTrade')} value={money(pricing.totalLessTrade)} bold />
                  <tr className="bos-pp-row">
                    <td>
                      {t('desking.taxOnTotal', { taxType: pricing.taxLabel })}
                      {taxExempt && <span className="bos-exempt-tag">(EXEMPT — Section 87)</span>}
                    </td>
                    <td className="bos-right">{money(pricing.taxAmount)}</td>
                  </tr>

                  {fees.map((f) => (
                    <tr className="bos-pp-row" key={`fee-${f?.id}`}>
                      <td>{f?.label}</td>
                      <td className="bos-right">{money(f?.amount)}</td>
                    </tr>
                  ))}

                  {fiExcludingWarranty.map((p) => (
                    <tr className="bos-pp-row" key={`fi-${p?.id}`}>
                      <td>{p?.label}</td>
                      <td className="bos-right">{money(p?.price)}</td>
                    </tr>
                  ))}

                  <Row blank />
                  <Row label={t('desking.totalPurchasePrice')} value={money(pricing.totalPurchasePrice)} bold />
                  <Row blank />
                  <Row label={t('desking.amountFinancedSubjectApproval')} value={money(financing.amountFinanced)} bold />
                </tbody>
              </table>
            </td>
          </tr>
        </tbody>
      </table>

      {/* ============== FINANCING TERMS + SALES FINAL ============== */}
      <table className="bos-table" style={{ marginTop: 4, tableLayout: 'fixed' }}>
        <tbody>
          <tr>
            {/* LEFT — Financing Terms */}
            <td style={{ width: '60%', padding: 0, verticalAlign: 'top' }}>
              <table className="bos-table" style={{ border: 'none' }}>
                <tbody>
                  <tr className="bos-section-dark"><td colSpan={2}>{t('desking.financingTerms')}</td></tr>
                  <Row label={t('desking.principalAmount')} value={money(financing.amountFinanced)} />
                  <Row label="Life Insurance" value={money(products.lifeInsurance)} />
                  <Row label="Accident & Health Insurance" value={money(products.ahInsurance)} />
                  <Row label="Loss Of Income Insurance" value="\u00a0" />
                  <Row label="PST On Total Insurance" value="\u00a0" />
                  <Row label={`Registration / PPSA ${products.ppsaFee ? `(${money(products.ppsaFee)})` : ''}`} value={money(products.ppsaFee)} />
                  <tr className="bos-pp-grand">
                    <td>{t('desking.totalToBeFinanced')}</td>
                    <td className="bos-right">{money(financing.totalToBeFinanced)}</td>
                  </tr>
                  <tr>
                    <td><span className="bos-label">{t('desking.payment')}:</span> {money(financing.paymentAmount)}</td>
                    <td>
                      <span className="bos-label">{t('desking.numberOfPayments', { frequency: financing.paymentFrequency })}:</span>{' '}
                      {financing.numberOfPayments || ''}
                    </td>
                  </tr>
                  <tr>
                    <td><span className="bos-label">{t('desking.finalPayment')}:</span> {money(financing.paymentAmount)}</td>
                    <td><span className="bos-label">{t('desking.paymentsStartDate')}:</span> {financing.paymentsStartDate || '\u00a0'}</td>
                  </tr>
                  <tr>
                    <td><span className="bos-label">Rate:</span> {financing.rate != null ? `${financing.rate}% APR` : '\u00a0'}</td>
                    <td><span className="bos-label">Term:</span> {financing.term ? `${financing.term} months` : '\u00a0'}</td>
                  </tr>
                  <tr>
                    <td colSpan={2}>
                      <span className="bos-label">Lender:</span> {financing.lender?.name || '\u00a0'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </td>

            {/* RIGHT — Sales Final */}
            <td style={{ width: '40%', verticalAlign: 'top' }}>
              <div className="bos-sales-final-box">
                <div className="hdr">{t('desking.salesFinal')}</div>
                <div>{t('desking.salesFinalText')}</div>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      {/* ============== SIGNATURES ============== */}
      <table className="bos-table" style={{ marginTop: 6 }}>
        <tbody>
          <tr>
            <td style={{ width: '50%' }}>
              <div><span className="bos-x">X</span>_________________________________</div>
              <div className="bos-label" style={{ marginTop: 2 }}>Purchaser's Signature</div>
            </td>
            <td>
              <div><span className="bos-x">X</span>_________________________________</div>
              <div className="bos-label" style={{ marginTop: 2 }}>Co-Signer Signature</div>
            </td>
          </tr>
          <tr>
            <td>
              <div><span className="bos-label">Sales Manager:</span></div>
              <div style={{ marginTop: 10 }}>_____________________________________</div>
              <div className="bos-label">Signature</div>
            </td>
            <td>
              <div><span className="bos-label">Sales Person Name:</span> {customer.salesperson || '\u00a0'}</div>
              <div style={{ marginTop: 10 }}>_____________________________________</div>
              <div className="bos-label">Signature</div>
            </td>
          </tr>
        </tbody>
      </table>

      {/* ============== COMMENTS ============== */}
      <table className="bos-table" style={{ marginTop: 4 }}>
        <tbody>
          <tr className="bos-section-gray"><td>{t('desking.comments')}</td></tr>
          <tr><td style={{ height: 40 }}>&nbsp;</td></tr>
        </tbody>
      </table>

      {/* ============== FOOTER BANNER ============== */}
      <div className="bos-footer-banner">
        In order to be informed of current and future recalls you should register the vehicle with the manufacturer.
      </div>

      {/* =========================================================
           PAGE 2 — Additional Terms (template — dealer to finalize)
           ========================================================= */}
      <div className="bos-page-break" />

      <div className="bos-title" style={{ marginBottom: 8 }}>Preowned Vehicle: Additional Terms</div>

      <div className="bos-legal">
        <h2><span className="num">1.</span> Safety Standards Certificate and Transfer Documents</h2>
        <p>
          A Safety Standards Certificate is only an indication that the motor vehicle met certain basic
          standards of vehicle safety on the date of inspection. It is not a warranty of future performance
          or reliability. Where the vehicle is sold as an unfit motor vehicle, the Purchaser acknowledges
          receipt of the applicable Unfit Motor Vehicle Permit and understands the vehicle may not be driven
          on a highway until it has been certified.
        </p>

        <h2><span className="num">1A.</span> Subject to Finance Approval</h2>
        <p>
          THIS IS NOT THE FINAL BILL OF SALE. This agreement is subject to finance approval by the lender.
          Final terms, including rate and payment, may be adjusted upon receipt of the lender's approval.
        </p>

        <h2><span className="num">2.</span> Trade-Ins</h2>
        <p>
          The Purchaser represents that any trade-in vehicle is owned by the Purchaser, is free of any
          undisclosed lien or encumbrance, and that all information provided about the trade-in is accurate.
          Any lien payoff amount shown is as of the date signed; the Purchaser remains responsible for any
          shortfall if the actual payoff is greater than stated.
        </p>

        <h2><span className="num">3.</span> Warranties</h2>
        <p>
          Except as expressly provided in any separate written warranty document, the Dealer makes no
          warranty, express or implied, including any implied warranty of merchantability or fitness for a
          particular purpose, to the fullest extent permitted by applicable consumer protection legislation.
          Manufacturer warranties (if any) are provided by the manufacturer and not the Dealer.
        </p>

        <h2><span className="num">4.</span> Payment of Additional and Increased Taxes</h2>
        <p>
          If any applicable tax, levy, or government charge is increased, added, or reassessed between the
          date of this agreement and the date of delivery, the Purchaser agrees to pay the adjusted amount.
        </p>

        <h2><span className="num">5.</span> Financing Information</h2>
        <p>
          Where financing is arranged through the Dealer, the Purchaser acknowledges receipt of the cost of
          borrowing disclosure required under applicable consumer protection legislation. The final cost of
          borrowing is set by the lending institution and is not shown on this bill of sale.
        </p>

        <h2><span className="num">6.</span> Ownership Transfers Only Upon Payment in Full</h2>
        <p>
          Title to the vehicle remains with the Dealer until the Purchaser has paid the Total Purchase Price
          in full, either directly or through an approved financing arrangement funded to the Dealer. Delivery
          of possession does not transfer title.
        </p>

        <h2><span className="num">7.</span> Credit / Security / Default Payment Information</h2>
        <p>
          The Purchaser authorizes the Dealer and the lender (if any) to obtain credit information necessary
          to evaluate and administer the financing. In the event of default, the Purchaser may be responsible
          for costs of collection, including reasonable legal fees, to the extent permitted by law.
        </p>

        <h2><span className="num">8.</span> Cancellation and Acceptance by Purchaser</h2>
        <p>
          This agreement may be cancelled only as expressly permitted by applicable consumer protection
          legislation. The Purchaser acknowledges that once signed and delivery has occurred, this agreement
          is final except where legislation provides otherwise.
        </p>

        <h2><span className="num">9.</span> Legal Acknowledgements</h2>
        <p>
          The Purchaser acknowledges reading and understanding the front and back of this agreement, has had
          an opportunity to ask questions, and agrees to its terms.
        </p>
        <p style={{ marginTop: 8 }}>
          <span className="bos-label">Customer Signature:</span> _________________________________
          &nbsp;&nbsp; <span className="bos-label">Date:</span> __________________
        </p>

        <h2><span className="num">10.</span> Canadian Motor Vehicle Arbitration Plan (CAMVAP)</h2>
        <p>
          Where applicable, disputes concerning the manufacture or assembly of a covered vehicle may be
          resolved under the Canadian Motor Vehicle Arbitration Plan (CAMVAP). Ask the Dealer whether this
          vehicle's manufacturer participates in CAMVAP.
        </p>

        <h2><span className="num">11.</span> CAMVAP Not Available</h2>
        <p>
          If the manufacturer of this vehicle does not participate in CAMVAP, the Purchaser's remedies with
          respect to manufacturing or assembly issues are governed by the manufacturer's written warranty and
          applicable law, and not by CAMVAP.
        </p>

        <h2><span className="num">12.</span> Concerns and Rights</h2>
        <p>
          CONCERNS AND RIGHTS: In case of any concerns with this sale, see the attached form "Vehicle
          Disclosure Information." Contact The Ontario Motor Vehicle Industry Council. 1-800-943-6002 or{' '}
          <span style={{ textDecoration: 'underline' }}>www.omvic.on.ca</span>.
        </p>

        <div style={{ marginTop: 14, display: 'flex', gap: 24 }}>
          <div style={{ flex: 1 }}>
            <div>_________________________________</div>
            <div className="bos-label">Purchaser's Signature</div>
          </div>
          <div style={{ flex: 1 }}>
            <div>_________________________________</div>
            <div className="bos-label">Seller's Signature</div>
          </div>
          <div style={{ flex: 1 }}>
            <div>_________________________________</div>
            <div className="bos-label">Date</div>
          </div>
        </div>

        <div className="bos-template-note">
          Legal terms above are a template. Final wording must be reviewed and adapted by the Dealer's legal
          counsel before presentation to a Purchaser for signature.
        </div>
      </div>
    </div>
  );
}

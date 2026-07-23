import { useQuery } from "@tanstack/react-query";
import { X, Building2, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "../../supabaseClient";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

const money = (cents) =>
  new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" })
    .format((Number(cents) || 0) / 100);

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function SupplierDetailDrawer({ supplier, onClose }) {
  const { data: expenses = [], isLoading } = useQuery({
    queryKey: ["expenses", "by-supplier", supplier?.id],
    enabled: !!supplier?.id,
    queryFn: async () => {
      const headers = await authHeaders();
      const r = await fetch(
        `${API_URL}/expenses?supplier_id=${supplier.id}`,
        { headers }
      );
      if (!r.ok) throw new Error("Failed to load expenses");
      return r.json();
    },
  });

  if (!supplier) return null;

  const total = expenses.reduce(
    (sum, e) => sum + (e.amount_cents || 0) + (e.tax_cents || 0),
    0
  );

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex justify-end"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-3xl h-full overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-amber-400 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Building2 className="w-6 h-6 text-gray-800" />
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                {supplier.name}
              </h2>
              {supplier.category && (
                <p className="text-sm text-gray-700">{supplier.category}</p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-gray-700 hover:text-black"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-4 grid grid-cols-2 gap-4 text-sm border-b">
          <div>
            <span className="text-gray-500">Phone:</span>{" "}
            {supplier.phone || "—"}
          </div>
          <div>
            <span className="text-gray-500">Email:</span>{" "}
            {supplier.email || "—"}
          </div>
          <div>
            <span className="text-gray-500">City:</span>{" "}
            {supplier.city || "—"}
          </div>
          <div>
            <span className="text-gray-500">Default Type:</span>{" "}
            {supplier.default_expense_type || "—"}
          </div>
          {supplier.tax_exempt && (
            <div className="col-span-2 text-amber-700">
              ⚠ Tax Exempt — expenses with this supplier auto-zero tax.
            </div>
          )}
        </div>

        <div className="px-6 py-4">
          <h3 className="font-medium mb-3">
            Expense History ({expenses.length})
          </h3>

          {isLoading && (
            <p className="text-gray-500 text-sm">Loading expenses…</p>
          )}

          {!isLoading && expenses.length === 0 && (
            <p className="text-gray-500 text-sm">
              No expenses recorded for this supplier yet.
            </p>
          )}

          {!isLoading && expenses.length > 0 && (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Stock #</th>
                  <th className="px-3 py-2 font-medium">Category</th>
                  <th className="px-3 py-2 font-medium">Invoice #</th>
                  <th className="px-3 py-2 font-medium text-right">Amount</th>
                  <th className="px-3 py-2 font-medium text-right">Tax</th>
                  <th className="px-3 py-2 font-medium text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((e) => {
                  const lineTotal =
                    (e.amount_cents || 0) + (e.tax_cents || 0);
                  return (
                    <tr key={e.id} className="border-t">
                      <td className="px-3 py-2">{e.expense_date}</td>
                      <td className="px-3 py-2">
                        {e.inventory_id ? (
                          <Link
                            to={`/inventory/${e.inventory_id}`}
                            className="text-blue-600 hover:underline inline-flex items-center gap-1"
                          >
                            {e.stock_number || "—"}
                            <ExternalLink className="w-3 h-3" />
                          </Link>
                        ) : (
                          e.stock_number || "—"
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {e.category?.label || e.category_code || "—"}
                      </td>
                      <td className="px-3 py-2">
                        {e.invoice_number || "—"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {money(e.amount_cents)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {money(e.tax_cents)}
                      </td>
                      <td className="px-3 py-2 text-right font-medium">
                        {money(lineTotal)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-300 bg-gray-50">
                  <td colSpan={6} className="px-3 py-3 font-semibold text-right">
                    Total
                  </td>
                  <td className="px-3 py-3 font-semibold text-right">
                    {money(total)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Search, Building2, Upload } from "lucide-react";
import { supabase } from "../../supabaseClient";
import EditSupplierModal from "../expenses/EditSupplierModal";
import SupplierDetailDrawer from "./SupplierDetailDrawer";
import ImportSuppliersModal from "./ImportSuppliersModal";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function SuppliersPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(null);
  const [showInactive, setShowInactive] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [importing, setImporting] = useState(false);

  const { data: expenseCategories = [] } = useQuery({
    queryKey: ["expense-categories"],
    queryFn: async () => {
      const r = await fetch(`${API_URL}/expenses/categories`);
      if (!r.ok) return [];
      return r.json();
    },
  });

  const { data: suppliers = [], isLoading } = useQuery({
    queryKey: ["suppliers", "all"],
    queryFn: async () => {
      const headers = await authHeaders();
      const r = await fetch(`${API_URL}/suppliers`, { headers });
      if (!r.ok) throw new Error("Failed to load suppliers");
      return r.json();
    },
  });

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return suppliers
      .filter((s) => showInactive || s.is_active !== false)
      .filter((s) => {
        if (!needle) return true;
        return [s.name, s.category, s.city, s.phone, s.email]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(needle));
      })
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [suppliers, q, showInactive]);

  const closeModal = (saved) => {
    setEditing(null);
    if (saved) qc.invalidateQueries({ queryKey: ["suppliers"] });
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Building2 className="w-7 h-7 text-amber-500" />
          <h1 className="text-2xl font-semibold">Suppliers</h1>
          <span className="text-sm text-gray-500">
            ({filtered.length} of {suppliers.length})
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setImporting(true)}
            className="flex items-center gap-2 px-4 py-2 border border-amber-500 text-amber-600 hover:bg-amber-50 rounded-md font-medium"
          >
            <Upload className="w-4 h-4" /> Import CSV
          </button>
          <button
            onClick={() => setEditing({})}
            className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-md font-medium"
          >
            <Plus className="w-4 h-4" /> New Supplier
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, category, city, phone, email…"
            className="w-full pl-10 pr-3 py-2 border rounded-md"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Show inactive
        </label>
      </div>

      <div className="bg-white border rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Category</th>
              <th className="px-4 py-3 font-medium">City</th>
              <th className="px-4 py-3 font-medium">Phone</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Default Type</th>
              <th className="px-4 py-3 font-medium text-center">Tax Exempt</th>
              <th className="px-4 py-3 font-medium w-10"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                  Loading…
                </td>
              </tr>
            )}
            {!isLoading && filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                  No suppliers found.
                </td>
              </tr>
            )}
            {filtered.map((s) => (
              <tr
                key={s.id}
                className={`border-t hover:bg-gray-50 ${
                  s.is_active === false ? "text-gray-400" : ""
                }`}
              >
                <td className="px-4 py-2 font-medium">
                  <button
                    onClick={() => setViewing(s)}
                    className="text-left text-blue-600 hover:underline"
                  >
                    {s.name}
                  </button>
                </td>
                <td className="px-4 py-2">{s.category || "—"}</td>
                <td className="px-4 py-2">{s.city || "—"}</td>
                <td className="px-4 py-2">{s.phone || "—"}</td>
                <td className="px-4 py-2">{s.email || "—"}</td>
                <td className="px-4 py-2">{s.default_expense_type || "—"}</td>
                <td className="px-4 py-2 text-center">
                  {s.tax_exempt ? "✓" : ""}
                </td>
                <td className="px-4 py-2">
                  <button
                    onClick={() => setEditing(s)}
                    className="p-1 text-gray-500 hover:text-amber-600"
                    title="Edit supplier"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {viewing && (
        <SupplierDetailDrawer
          supplier={viewing}
          onClose={() => setViewing(null)}
        />
      )}

      {importing && (
        <ImportSuppliersModal
          onClose={() => setImporting(false)}
          onComplete={() => qc.invalidateQueries({ queryKey: ["suppliers"] })}
        />
      )}

      {editing !== null && (
        <EditSupplierModal
          supplier={editing.id ? editing : null}
          expenseCategories={expenseCategories}
          onClose={() => closeModal(false)}
          onSaved={() => closeModal(true)}
        />
      )}
    </div>
  );
}

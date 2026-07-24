import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { useForm } from 'react-hook-form';
import { DataTable, type ColumnDef } from './data-table.js';
import { Form, FormControl, FormField, FormHint, FormItem, FormLabel, FormMessage } from './form.js';
import { Input } from './field.js';

interface Row {
  name: string;
  code: string;
}
const columns: ColumnDef<Row, unknown>[] = [
  { accessorKey: 'name', header: 'Nom' },
  { accessorKey: 'code', header: 'Code' },
];
const stateProps = {
  loadingMessage: 'Chargement…',
  errorMessage: 'Erreur',
  emptyMessage: 'Vide',
};

describe('DataTable', () => {
  it('renders loading, error, and empty states with correct semantics', () => {
    expect(renderToStaticMarkup(<DataTable columns={columns} data={undefined} isPending {...stateProps} />)).toContain(
      'aria-busy',
    );
    expect(renderToStaticMarkup(<DataTable columns={columns} data={undefined} isError {...stateProps} />)).toContain(
      'role="alert"',
    );
    expect(renderToStaticMarkup(<DataTable columns={columns} data={[]} {...stateProps} />)).toContain('Vide');
  });

  it('renders rows inside an overflow container with sortable headers on tokens', () => {
    const html = renderToStaticMarkup(
      <DataTable columns={columns} data={[{ name: 'Kia ML', code: 'KML' }]} {...stateProps} />,
    );
    expect(html).toContain('overflow-x-auto');
    expect(html).toContain('Kia ML');
    expect(html).toContain('<button'); // sortable header control
    expect(html).not.toMatch(/(?:bg|text|border)-(?:blue|red|gray|slate)-\d/);
  });
});

function ProbeForm({ withError }: { withError?: boolean }) {
  const form = useForm<{ name: string }>({
    defaultValues: { name: '' },
    errors: withError ? { name: { type: 'server', message: 'Nom requis' } } : undefined,
  });
  return (
    <Form {...form}>
      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Nom</FormLabel>
            <FormControl hasHint>
              <Input {...field} />
            </FormControl>
            <FormHint>Indice</FormHint>
            <FormMessage />
          </FormItem>
        )}
      />
    </Form>
  );
}

describe('Form composition', () => {
  it('wires label, control, and hint together with shared ids', () => {
    const html = renderToStaticMarkup(<ProbeForm />);
    const forId = /for="([^"]+)"/.exec(html)?.[1];
    expect(forId).toBeTruthy();
    expect(html).toContain(`id="${forId}"`);
    expect(html).toContain(`aria-describedby="${forId}-hint"`);
    expect(html).toContain(`id="${forId}-hint"`);
  });

  it('renders the error with role alert, aria-invalid, and describedby linkage', () => {
    const html = renderToStaticMarkup(<ProbeForm withError />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('Nom requis');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toMatch(/aria-describedby="[^"]*-error"|aria-describedby="[^"]*-hint [^"]*-error"/);
  });
});

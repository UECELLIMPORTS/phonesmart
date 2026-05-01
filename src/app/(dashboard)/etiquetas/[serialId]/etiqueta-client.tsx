'use client'

import { useState } from 'react'
import { Printer, ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { ImeiLabel, type LabelData } from '@/components/labels/imei-label'

export function EtiquetaClient({ data, qty }: { data: LabelData; qty: number }) {
  const [count, setCount] = useState(qty)

  return (
    <div>
      {/* Toolbar (hidden on print) */}
      <div className="no-print mb-6 flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/estoque"
            className="inline-flex items-center gap-1.5 text-sm text-zinc-600 hover:text-zinc-900"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-zinc-700">
            Cópias:
            <input
              type="number"
              min="1"
              max="20"
              value={count}
              onChange={e => setCount(Math.min(20, Math.max(1, parseInt(e.target.value) || 1)))}
              className="w-16 rounded-lg border border-zinc-200 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
            />
          </label>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-600"
          >
            <Printer className="h-4 w-4" />
            Imprimir
          </button>
        </div>
      </div>

      <div className="no-print mb-4 text-xs text-zinc-500">
        Configure sua impressora térmica pra papel <span className="font-semibold">80×50mm</span>.
        Margens 0. Pré-visualize antes de imprimir grandes quantidades.
      </div>

      {Array.from({ length: count }, (_, i) => (
        <ImeiLabel key={i} data={data} />
      ))}
    </div>
  )
}

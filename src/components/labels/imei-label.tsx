'use client'

/**
 * Etiqueta de IMEI pra impressora térmica (80mm padrão ou 58mm).
 * Renderiza HTML otimizado pra impressão direta. QR code é gerado client-side.
 *
 * Uso: abre window.print() na página dedicada /etiquetas/[serialId].
 */

import { useEffect, useState, useRef } from 'react'
import QRCode from 'qrcode'

const BRL = (c: number | null | undefined) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((c ?? 0) / 100)

export type LabelData = {
  serial:        string
  productName:   string
  storeName:     string
  priceCents?:   number
  condition?:    'A' | 'B' | 'C' | 'defective' | null
  acquiredAt?:   string | null
}

const CONDITION_LABEL: Record<'A' | 'B' | 'C' | 'defective', string> = {
  A:         'Impecável',
  B:         'Bom',
  C:         'Com sinais',
  defective: 'Defeito',
}

export function ImeiLabel({ data, autoprint = false }: { data: LabelData; autoprint?: boolean }) {
  const [qrSvg, setQrSvg] = useState<string>('')
  const printedRef = useRef(false)

  useEffect(() => {
    QRCode.toString(data.serial, {
      type:        'svg',
      errorCorrectionLevel: 'M',
      margin:      1,
      width:       140,
    }).then(svg => setQrSvg(svg))
  }, [data.serial])

  useEffect(() => {
    if (autoprint && qrSvg && !printedRef.current) {
      printedRef.current = true
      // Pequeno delay pra garantir paint
      setTimeout(() => window.print(), 200)
    }
  }, [autoprint, qrSvg])

  const ack = data.acquiredAt ? new Date(data.acquiredAt).toLocaleDateString('pt-BR') : null

  return (
    <>
      <style jsx global>{`
        @media print {
          @page {
            size: 80mm 50mm;
            margin: 0;
          }
          body {
            margin: 0;
            padding: 0;
          }
          .no-print { display: none !important; }
          .label-page {
            page-break-after: always;
          }
          .label-page:last-child {
            page-break-after: auto;
          }
        }
        @media screen {
          body {
            background: #f5f5f5;
            padding: 20px;
          }
        }
        .label {
          width: 80mm;
          height: 50mm;
          background: white;
          padding: 3mm;
          font-family: -apple-system, "Helvetica Neue", Arial, sans-serif;
          color: #000;
          display: flex;
          gap: 3mm;
          box-sizing: border-box;
          border: 1px solid #e5e5e5;
        }
        @media screen {
          .label {
            margin: 0 auto 16px;
            box-shadow: 0 2px 6px rgba(0,0,0,0.08);
          }
        }
        .label-qr {
          width: 28mm;
          height: 28mm;
          flex-shrink: 0;
        }
        .label-qr svg {
          width: 100%;
          height: 100%;
        }
        .label-info {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        }
        .label-store {
          font-size: 7pt;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: #333;
        }
        .label-product {
          font-size: 8.5pt;
          font-weight: 700;
          line-height: 1.1;
          margin: 1mm 0;
          word-wrap: break-word;
        }
        .label-imei {
          font-family: "SF Mono", Menlo, Consolas, monospace;
          font-size: 9pt;
          font-weight: 700;
          letter-spacing: 0.5px;
          margin-top: 1mm;
        }
        .label-meta {
          font-size: 6.5pt;
          color: #555;
          margin-top: 1mm;
          display: flex;
          gap: 3mm;
          flex-wrap: wrap;
        }
        .label-price {
          font-size: 11pt;
          font-weight: 800;
          color: #000;
        }
      `}</style>

      <div className="label-page">
        <div className="label">
          <div className="label-qr" dangerouslySetInnerHTML={{ __html: qrSvg }} />
          <div className="label-info">
            <div>
              <div className="label-store">{data.storeName}</div>
              <div className="label-product">{data.productName}</div>
              <div className="label-imei">IMEI {data.serial}</div>
              <div className="label-meta">
                {data.condition && <span>Cond: {CONDITION_LABEL[data.condition]}</span>}
                {ack && <span>Entrada: {ack}</span>}
              </div>
            </div>
            {data.priceCents != null && data.priceCents > 0 && (
              <div className="label-price">{BRL(data.priceCents)}</div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

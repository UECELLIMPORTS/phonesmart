'use client'

import { useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'

// ── Brazilian states ───────────────────────────────────────────────────────

const ESTADOS = [
  { uf: 'AC', nome: 'Acre' },
  { uf: 'AL', nome: 'Alagoas' },
  { uf: 'AP', nome: 'Amapá' },
  { uf: 'AM', nome: 'Amazonas' },
  { uf: 'BA', nome: 'Bahia' },
  { uf: 'CE', nome: 'Ceará' },
  { uf: 'DF', nome: 'Distrito Federal' },
  { uf: 'ES', nome: 'Espírito Santo' },
  { uf: 'GO', nome: 'Goiás' },
  { uf: 'MA', nome: 'Maranhão' },
  { uf: 'MT', nome: 'Mato Grosso' },
  { uf: 'MS', nome: 'Mato Grosso do Sul' },
  { uf: 'MG', nome: 'Minas Gerais' },
  { uf: 'PA', nome: 'Pará' },
  { uf: 'PB', nome: 'Paraíba' },
  { uf: 'PR', nome: 'Paraná' },
  { uf: 'PE', nome: 'Pernambuco' },
  { uf: 'PI', nome: 'Piauí' },
  { uf: 'RJ', nome: 'Rio de Janeiro' },
  { uf: 'RN', nome: 'Rio Grande do Norte' },
  { uf: 'RS', nome: 'Rio Grande do Sul' },
  { uf: 'RO', nome: 'Rondônia' },
  { uf: 'RR', nome: 'Roraima' },
  { uf: 'SC', nome: 'Santa Catarina' },
  { uf: 'SP', nome: 'São Paulo' },
  { uf: 'SE', nome: 'Sergipe' },
  { uf: 'TO', nome: 'Tocantins' },
]

// ── Types ──────────────────────────────────────────────────────────────────

type Props = {
  state: string
  city: string
  onStateChange: (uf: string) => void
  onCityChange: (city: string) => void
  inputCls: string
  inputStyle: React.CSSProperties
}

// ── Component ──────────────────────────────────────────────────────────────

export function AddressCityState({ state, city, onStateChange, onCityChange, inputCls, inputStyle }: Props) {
  const [cities, setCities]     = useState<string[]>([])
  const [loading, setLoading]   = useState(false)

  // Load cities whenever state (UF) changes
  useEffect(() => {
    if (!state) { setCities([]); return }

    setLoading(true)
    fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${state}/municipios?orderBy=nome`)
      .then(r => r.json())
      .then((data: { nome: string }[]) => {
        const names = data.map(d => d.nome)
        setCities(names)
        // Auto-select city if parent already has one (e.g., from CEP auto-fill)
        if (city && !names.includes(city)) {
          // Try case-insensitive match
          const match = names.find(n => n.toLowerCase() === city.toLowerCase())
          if (match) onCityChange(match)
        }
      })
      .catch(() => setCities([]))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    appearance: 'none',
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2364748B' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 12px center',
    paddingRight: '36px',
    cursor: 'pointer',
  }

  return (
    <div className="grid grid-cols-[1fr_140px] gap-2">
      {/* City */}
      <div className="relative">
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted z-10 pointer-events-none" />
        )}
        {cities.length > 0 ? (
          <select
            value={city}
            onChange={e => onCityChange(e.target.value)}
            className={inputCls}
            style={selectStyle}
          >
            <option value="">Selecione a cidade</option>
            {cities.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        ) : (
          <input
            value={city}
            onChange={e => onCityChange(e.target.value)}
            placeholder={loading ? 'Carregando cidades...' : 'Cidade'}
            className={inputCls}
            style={inputStyle}
            disabled={loading}
          />
        )}
      </div>

      {/* State (UF) */}
      <select
        value={state}
        onChange={e => { onStateChange(e.target.value); onCityChange('') }}
        className={inputCls}
        style={selectStyle}
      >
        <option value="">UF</option>
        {ESTADOS.map(e => (
          <option key={e.uf} value={e.uf}>{e.uf} — {e.nome}</option>
        ))}
      </select>
    </div>
  )
}

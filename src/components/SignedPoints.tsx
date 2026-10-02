import { useEffect, useState } from 'react'
export function SignedPoints({value, onChange}: {value: number; onChange: (value: number) => void}) {
  const [direction, setDirection] = useState(value < 0 ? -1 : 1)
  const [amount, setAmount] = useState(String(Math.abs(value)))
  useEffect(() => { setAmount(String(Math.abs(value))); if(value !== 0) setDirection(value < 0 ? -1 : 1) }, [value])
  return <div><label>Action<select value={direction} onChange={e => {
    const next = Number(e.target.value); setDirection(next)
    if(amount !== '') onChange(next * Number(amount))
  }}><option value="1">Add points</option><option value="-1">Deduct points</option></select></label>
    <label>Point amount<input required type="text" inputMode="numeric" pattern="[0-9]{1,4}" maxLength={4} value={amount} onChange={e => {
      const next = e.target.value
      if (!/^[0-9]{0,4}$/.test(next) || Number(next) > 1000) return
      setAmount(next); if(next !== '') onChange(direction * Number(next))
    }} /></label><small>{direction < 0 ? 'Deduct' : 'Add'} {amount || '0'} points. Maximum 1000.</small>
  </div>
}

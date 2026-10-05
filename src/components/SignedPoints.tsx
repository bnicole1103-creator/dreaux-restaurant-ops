import { ScreenText } from "./ScreenText"
import { useEffect, useState } from 'react'
export function SignedPoints({value, onChange}: {value: number; onChange: (value: number) => void}) {
  const [direction, setDirection] = useState(value < 0 ? -1 : 1)
  const [amount, setAmount] = useState(String(Math.abs(value)))
  useEffect(() => { setAmount(String(Math.abs(value))); if(value !== 0) setDirection(value < 0 ? -1 : 1) }, [value])
  return <div><label><ScreenText id="SignedPoints.13b469b07e1e0249">Action</ScreenText><select value={direction} onChange={e => {
    const next = Number(e.target.value); setDirection(next)
    if(amount !== '') onChange(next * Number(amount))
  }}><option value="1"><ScreenText id="SignedPoints.9d65f816c4f51b45">Add points</ScreenText></option><option value="-1"><ScreenText id="SignedPoints.d2f17814093a629f">Deduct points</ScreenText></option></select></label>
    <label><ScreenText id="SignedPoints.20ce811bf513231d">Point amount</ScreenText><input required type="text" inputMode="numeric" pattern="[0-9]{1,4}" maxLength={4} value={amount} onChange={e => {
      const next = e.target.value
      if (!/^[0-9]{0,4}$/.test(next) || Number(next) > 1000) return
      setAmount(next); if(next !== '') onChange(direction * Number(next))
    }} /></label><small>{direction < 0 ? 'Deduct' : 'Add'} {amount || '0'}<ScreenText id="SignedPoints.54cfc4a26f7f6c4d"> points. Maximum 1000.</ScreenText></small>
  </div>
}

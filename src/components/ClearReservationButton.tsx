import {useEffect, useRef, useState} from 'react'
import {notifyReservationsChanged} from '../lib/reservationSync'
import {supabase} from '../lib/supabase'

const centralClock = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'America/Chicago',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

function hasPassed(date: string, time: string | null) {
  const [today, now] = centralClock.format(new Date()).split(' ')
  if (date !== today) return date < today
  if (!time) return false
  const match = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.\d+)?)?$/.exec(time)
  return !!match && `${match[1]}:${match[2]}:${match[3] ?? '00'}` < now
}

type Props = {
  location: string
  day: string
  reservation: {
    id: string
    guest_name: string
    reservation_time: string | null
    status: string
    edit_version: number
  }
  disabled?: boolean
}

export function ClearReservationButton({location, day, reservation, disabled}: Props) {
  const [past, setPast] = useState(()=>hasPassed(day, reservation.reservation_time))
  const [busy, setBusy] = useState(false)
  const [cleared, setCleared] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const status = reservation.status?.trim().toLowerCase()
  const waiting = ['booked', 'confirmed'].includes(status)
  const eligible = waiting || ['arrived', 'partially_arrived'].includes(status)
  const [choosing, setChoosing] = useState(false)

  useEffect(()=>{
    if (!eligible) return
    const check = ()=>setPast(hasPassed(day, reservation.reservation_time))
    check()
    const timer = window.setInterval(check, 15000)
    return ()=>window.clearInterval(timer)
  }, [day, reservation.reservation_time, eligible])

  async function clear(outcome: 'completed' | 'no_show') {
    if (disabled || !eligible || (outcome === 'no_show' && !waiting) || lock.current || !hasPassed(day, reservation.reservation_time)) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      const {error} = await supabase.rpc('reservation_clear_past', {
        p_location_id: location,
        p_id: reservation.id,
        p_version: reservation.edit_version,
        p_outcome: outcome,
      })
      if (error) throw error
      setCleared(true)
      notifyReservationsChanged()
    } catch (error) {
      setError((error as Error).message)
      notifyReservationsChanged()
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  if (!eligible || !past || cleared) return null
  return <>
    <button type="button" disabled={disabled || busy} aria-expanded={choosing} onClick={()=>setChoosing(value=>!value)}>
      {busy ? 'Clearing…' : 'Clear reservation'}
    </button>
    {choosing && <div role="group" aria-label="How did the reservation end?">
      <p>Choose an outcome to clear this reservation and keep it in history.</p>
      <button type="button" disabled={disabled || busy} onClick={()=>void clear('completed')}>Showed up</button>
      {waiting && <button type="button" disabled={disabled || busy} onClick={()=>void clear('no_show')}>No-show</button>}
    </div>}
    {error && <span role="alert">{error}</span>}
  </>
}

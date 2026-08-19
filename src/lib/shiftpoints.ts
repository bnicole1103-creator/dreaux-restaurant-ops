export type PointAdjustment = {
  code: string
  description: string
  points: number
}

export type ShiftPointResult = {
  startingScore: number
  adjustments: PointAdjustment[]
  pointsDelta: number
  shiftScore: number
  minutesLate: number
  salesPercent: number
}

function timeToMinutes(time: string) {
  if (!time) return 0

  const [hours, minutes] = time.split(':').map(Number)

  return hours * 60 + minutes
}

export function calculateShiftPoints({
  scheduledTime,
  clockInTime,
  netSales,
  salesTarget,
  voidTotal,
  discountTotal,
  closeoutCompleted = true,
}: {
  scheduledTime: string
  clockInTime: string
  netSales: number
  salesTarget: number
  voidTotal: number
  discountTotal: number
  closeoutCompleted?: boolean
}): ShiftPointResult {
  const startingScore = 100
  const adjustments: PointAdjustment[] = []

  /*
   * LATENESS
   *
   * These do NOT stack.
   */

  const scheduledMinutes = timeToMinutes(scheduledTime)
  const actualMinutes = timeToMinutes(clockInTime)

  const minutesLate = Math.max(
    0,
    actualMinutes - scheduledMinutes
  )

  if (minutesLate >= 30) {
    adjustments.push({
      code: 'LATE_30_PLUS',
      description: `Clocked in ${minutesLate} minutes late`,
      points: -40,
    })
  } else if (minutesLate >= 15) {
    adjustments.push({
      code: 'LATE_15_29',
      description: `Clocked in ${minutesLate} minutes late`,
      points: -25,
    })
  } else if (minutesLate >= 6) {
    adjustments.push({
      code: 'LATE_6_14',
      description: `Clocked in ${minutesLate} minutes late`,
      points: -10,
    })
  } else if (minutesLate >= 1) {
    adjustments.push({
      code: 'LATE_1_5',
      description: `Clocked in ${minutesLate} minutes late`,
      points: -5,
    })
  }

  /*
   * SALES PERFORMANCE
   *
   * Highest achieved tier only.
   */

  const salesPercent =
    salesTarget > 0
      ? (netSales / salesTarget) * 100
      : 0

  if (salesTarget > 0) {
    if (salesPercent >= 125) {
      adjustments.push({
        code: 'SALES_125',
        description: `Reached ${salesPercent.toFixed(
          1
        )}% of sales target`,
        points: 40,
      })
    } else if (salesPercent >= 110) {
      adjustments.push({
        code: 'SALES_110',
        description: `Reached ${salesPercent.toFixed(
          1
        )}% of sales target`,
        points: 30,
      })
    } else if (salesPercent >= 100) {
      adjustments.push({
        code: 'SALES_TARGET',
        description: `Reached ${salesPercent.toFixed(
          1
        )}% of sales target`,
        points: 20,
      })
    }
  }

  /*
   * CLEAN SHIFT BONUSES
   */

  if (voidTotal === 0) {
    adjustments.push({
      code: 'NO_VOIDS',
      description: 'Completed shift with no voids',
      points: 5,
    })
  }

  if (discountTotal === 0) {
    adjustments.push({
      code: 'NO_DISCOUNTS',
      description: 'Completed shift with no discounts',
      points: 5,
    })
  }

  if (closeoutCompleted) {
    adjustments.push({
      code: 'CLOSEOUT_COMPLETE',
      description: 'Completed daily closeout',
      points: 5,
    })
  }

  const pointsDelta = adjustments.reduce(
    (total, adjustment) =>
      total + adjustment.points,
    0
  )

  return {
    startingScore,
    adjustments,
    pointsDelta,
    shiftScore: startingScore + pointsDelta,
    minutesLate,
    salesPercent,
  }
}
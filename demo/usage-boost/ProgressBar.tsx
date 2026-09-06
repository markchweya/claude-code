import React from 'react'
import { Text } from 'ink'

/**
 * Verbatim port of src/components/design-system/ProgressBar.tsx, minus the
 * theme indirection: the CLI resolves fillColor/emptyColor through its theme,
 * here we pass the resolved colours straight to Ink.
 */
const BLOCKS = [' ', '▏', '▎', '▍', '▌', '▋', '▊', '▉', '█']

type Props = {
  ratio: number
  width: number
  fillColor: string
  emptyColor: string
}

export function ProgressBar({ ratio: inputRatio, width, fillColor, emptyColor }: Props) {
  const ratio = Math.min(1, Math.max(0, inputRatio))
  const whole = Math.floor(ratio * width)
  const segments = [BLOCKS[BLOCKS.length - 1]!.repeat(whole)]
  if (whole < width) {
    const remainder = ratio * width - whole
    const middle = Math.floor(remainder * BLOCKS.length)
    segments.push(BLOCKS[middle]!)
    const empty = width - whole - 1
    if (empty > 0) segments.push(BLOCKS[0]!.repeat(empty))
  }
  return (
    <Text color={fillColor} backgroundColor={emptyColor}>
      {segments.join('')}
    </Text>
  )
}

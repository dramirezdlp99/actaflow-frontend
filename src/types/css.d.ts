import 'react'

// Variables CSS propias (--i, --retraso-sello...) en `style`, tipadas y sin recurrir a `as`.
declare module 'react' {
  interface CSSProperties {
    [variable: `--${string}`]: string | number | undefined
  }
}

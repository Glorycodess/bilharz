import { useState } from 'react'

// A password input with Show / Hide. `autoComplete` tells password managers
// whether this is the current password or a new one.
export default function PasswordField({ id, label, value, onChange, autoComplete, hint, disabled }) {
  const [shown, setShown] = useState(false)
  return (
    <div className="account__field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="password-field">
        <input
          id={id}
          className="input"
          type={shown ? 'text' : 'password'}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={hint ? `${id}-hint` : undefined}
          maxLength={128}
          required
          disabled={disabled}
        />
        <button
          type="button"
          className="password-field__toggle"
          onClick={() => setShown((s) => !s)}
          aria-pressed={shown}
          aria-controls={id}
        >
          {shown ? 'Hide' : 'Show'}
        </button>
      </div>
      {hint && (
        <p className="muted small account__hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
    </div>
  )
}

import { useState, type ComponentProps } from 'react';
import { Eye, EyeOff } from 'lucide-react';

export function PasswordInput(props: Omit<ComponentProps<'input'>, 'type'>) {
  const [visible, setVisible] = useState(false);
  const Icon = visible ? EyeOff : Eye;
  return <span className="relative block">
    <input {...props} type={visible ? 'text' : 'password'} className={`${props.className || 'login-input'} pr-12`} />
    <button type="button" disabled={props.disabled} aria-label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible}
      onClick={() => setVisible(value => !value)} className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-lg text-slate-500 hover:text-blue-700 focus-visible:outline-2 focus-visible:outline-blue-600">
      <Icon size={18} aria-hidden="true" />
    </button>
  </span>;
}

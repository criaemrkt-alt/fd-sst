import { AlertCircle, CheckCircle2, LoaderCircle, X } from 'lucide-react'
import type { ButtonHTMLAttributes, PropsWithChildren } from 'react'

export function Button({ className = '', children, ...props }: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>>) {
  return <button className={`button ${className}`} {...props}>{children}</button>
}

export function EmptyState({ title, children }: PropsWithChildren<{ title: string }>) {
  return <section className="empty-state"><AlertCircle size={28} /><h2>{title}</h2><p>{children}</p></section>
}

export function LoadingState() { return <div className="loading"><LoaderCircle className="spin" /> Carregando dados protegidos…</div> }

export function Notice({ kind = 'success', children }: PropsWithChildren<{ kind?: 'success' | 'error' | 'info' }>) {
  return <div className={`notice ${kind}`}>{kind === 'success' ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}{children}</div>
}

export function Modal({ title, children, onClose }: PropsWithChildren<{ title: string; onClose: () => void }>) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
      <header><h2>{title}</h2><button aria-label="Fechar" className="icon-button" onClick={onClose}><X /></button></header>{children}
    </section>
  </div>
}

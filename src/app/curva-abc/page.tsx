import { redirect } from 'next/navigation'

// A Curva ABC passou a fazer parte do relatório único de Produtos (ABC · Estoque · Margem).
export default function CurvaABCRedirect() {
  redirect('/produtos')
}

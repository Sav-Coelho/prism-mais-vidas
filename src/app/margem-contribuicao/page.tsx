import { redirect } from 'next/navigation'

// A Margem de Contribuição passou a fazer parte do relatório único de Produtos (ABC · Estoque · Margem).
export default function MargemContribuicaoRedirect() {
  redirect('/produtos')
}

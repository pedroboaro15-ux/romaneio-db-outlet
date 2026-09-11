import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { IcCadeado, IcAlerta, IcCheck } from '../componentes/Icones';

export default function Entrar() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [modoLink, setModoLink] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(''); setOk(''); setCarregando(true);
    try {
      if (modoLink) {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        setOk('Pronto! Abra seu e-mail e clique no link para entrar.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
        if (error) throw error;
      }
    } catch (err) {
      const m = (err as Error).message;
      setErro(
        /invalid login credentials/i.test(m) ? 'E-mail ou senha não conferem.' :
        /email not confirmed/i.test(m)       ? 'Confirme seu e-mail antes de entrar.' :
        /rate limit|too many/i.test(m)       ? 'Muitas tentativas. Espere um minuto.' :
        m
      );
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <div style={{
            width: 46, height: 46, margin: '0 auto 12px', borderRadius: 12,
            background: 'var(--acento)', color: '#fff', display: 'grid', placeItems: 'center',
          }}>
            <IcCadeado className="" />
          </div>
          <h1 style={{ fontSize: 20 }}>Estoque Outlet</h1>
          <p style={{ margin: '5px 0 0', fontSize: 13, color: 'var(--tinta-2)' }}>
            Área restrita. Entre com sua conta.
          </p>
        </div>

        <form className="cartao" style={{ padding: 20 }} onSubmit={enviar}>
          <label style={{ display: 'block', marginBottom: 13 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, display: 'block', marginBottom: 5 }}>
              E-mail
            </span>
            <input className="campo" type="email" required autoComplete="username"
                   value={email} onChange={(e) => setEmail(e.target.value)}
                   placeholder="seunome@email.com" />
          </label>

          {!modoLink && (
            <label style={{ display: 'block', marginBottom: 13 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, display: 'block', marginBottom: 5 }}>
                Senha
              </span>
              <input className="campo" type="password" required autoComplete="current-password"
                     value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="••••••••" />
            </label>
          )}

          {erro && (
            <div className="aviso erro" style={{ marginBottom: 13 }}>
              <IcAlerta className="" /><span>{erro}</span>
            </div>
          )}
          {ok && (
            <div className="aviso bom" style={{ marginBottom: 13 }}>
              <IcCheck className="" /><span>{ok}</span>
            </div>
          )}

          <button className="btn btn-primario btn-g" style={{ width: '100%' }} disabled={carregando}>
            {carregando ? 'Entrando…' : modoLink ? 'Receber link por e-mail' : 'Entrar'}
          </button>

          <button type="button" className="btn btn-fantasma btn-p"
                  style={{ width: '100%', marginTop: 9 }}
                  onClick={() => { setModoLink(!modoLink); setErro(''); setOk(''); }}>
            {modoLink ? 'Entrar com senha' : 'Esqueci a senha — receber link por e-mail'}
          </button>
        </form>

        <p style={{ fontSize: 11.5, color: 'var(--tinta-3)', textAlign: 'center', marginTop: 14 }}>
          Só quem o dono cadastrou consegue entrar.
        </p>
      </div>
    </div>
  );
}

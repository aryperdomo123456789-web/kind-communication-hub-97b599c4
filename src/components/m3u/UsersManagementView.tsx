import { useEffect, useState } from "react";
import { UserPlus, Shield, Trash2, ShieldCheck, User, Users } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { listUsers, createUser, deleteUserFn } from "@/lib/ssh.functions";
import { PanelUserRecord } from "@/lib/flussonic-connection-store";
import { Loader2 } from "lucide-react";

interface UsersManagementViewProps {
  adminUsername: string;
}

export function UsersManagementView({ adminUsername }: UsersManagementViewProps) {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  
  // Create User Form State
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<'admin' | 'user'>('user');
  const [newLimit, setNewLimit] = useState(5);

  const listUsersFn = useServerFn(listUsers);
  const createUserFn = useServerFn(createUser);
  const deleteUserFnHandler = useServerFn(deleteUserFn);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const res = await listUsersFn({ data: { adminUsername } });
      if (res.success) {
        setUsers(res.users || []);
      }
    } catch (error) {
      console.error("Erro ao listar usuários:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, [adminUsername]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername || !newPassword) return;
    
    setActionLoading("creating");
    try {
      const res = await createUserFn({
        data: {
          username: newUsername,
          password: newPassword,
          role: newRole,
          flussonicLimit: newLimit,
        }
      });
      if (res.success) {
        setNewUsername("");
        setNewPassword("");
        loadUsers();
      }
    } catch (error) {
      console.error("Erro ao criar usuário:", error);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteUser = async (username: string) => {
    if (username === adminUsername) return;
    if (!confirm(`Tem certeza que deseja excluir o usuário ${username}?`)) return;

    setActionLoading(username);
    try {
      const res = await deleteUserFnHandler({ data: { username } });
      if (res.success) {
        loadUsers();
      }
    } catch (error) {
      console.error("Erro ao deletar usuário:", error);
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-20">
      <div className="bg-[#141414] border border-white/5 rounded-2xl p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-xl bg-purple-600/20 flex items-center justify-center text-purple-500">
            <UserPlus size={24} />
          </div>
          <div>
            <h2 className="text-xl font-bold">Criar Novo Usuário</h2>
            <p className="text-sm text-neutral-400">Expanda sua rede e defina limites de uso.</p>
          </div>
        </div>

        <form onSubmit={handleCreateUser} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase text-neutral-500">E-mail / Usuário</label>
            <input
              type="email"
              required
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-purple-500"
              placeholder="cliente@exemplo.com"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase text-neutral-500">Senha</label>
            <input
              type="password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-purple-500"
              placeholder="••••••••"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase text-neutral-500">Função & Limite</label>
            <div className="flex gap-2">
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as any)}
                className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-purple-500"
              >
                <option value="user">Usuário</option>
                <option value="admin">Administrador</option>
              </select>
              <input
                type="number"
                value={newLimit}
                onChange={(e) => setNewLimit(Number(e.target.value))}
                className="w-20 bg-black/40 border border-white/10 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-purple-500"
                placeholder="Lim"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={actionLoading === "creating"}
            className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-bold py-2.5 rounded-lg transition-all flex items-center justify-center gap-2"
          >
            {actionLoading === "creating" ? <Loader2 size={18} className="animate-spin" /> : <UserPlus size={18} />}
            Cadastrar Usuário
          </button>
        </form>
      </div>

      <div className="bg-[#141414] border border-white/5 rounded-2xl overflow-hidden">
        <div className="p-6 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-600/20 flex items-center justify-center text-blue-500">
              <Users size={20} />
            </div>
            <h2 className="text-lg font-bold">Usuários Cadastrados</h2>
          </div>
          <div className="text-xs text-neutral-500 font-mono">
            {users.length} usuários no sistema
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-white/[0.02] text-neutral-500 text-[10px] uppercase font-bold tracking-widest border-b border-white/5">
                <th className="px-6 py-4">Usuário</th>
                <th className="px-6 py-4">Privilégio</th>
                <th className="px-6 py-4">Servidores</th>
                <th className="px-6 py-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-neutral-500 italic">
                    <Loader2 size={24} className="animate-spin mx-auto mb-2 opacity-20" />
                    Carregando base de dados...
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-neutral-500 italic">
                    Nenhum usuário encontrado na rede.
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr key={user.username} className="hover:bg-white/[0.01] transition-colors group">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-neutral-800 flex items-center justify-center text-neutral-500 group-hover:bg-blue-600/20 group-hover:text-blue-400 transition-colors">
                          <User size={14} />
                        </div>
                        <span className="text-sm font-medium">{user.username}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-tighter border ${
                        user.role === 'admin' 
                          ? 'bg-purple-500/10 text-purple-400 border-purple-500/20' 
                          : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                      }`}>
                        {user.role === 'admin' ? <ShieldCheck size={10} /> : <Shield size={10} />}
                        {user.role === 'admin' ? 'Dono' : 'Comum'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm text-neutral-400 font-mono">
                        {user.flussonicLimit === 999 ? '∞' : user.flussonicLimit}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      {user.username !== adminUsername ? (
                        <button
                          onClick={() => handleDeleteUser(user.username)}
                          disabled={actionLoading === user.username}
                          className="p-2 text-neutral-500 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all"
                        >
                          {actionLoading === user.username ? (
                            <Loader2 size={16} className="animate-spin" />
                          ) : (
                            <Trash2 size={16} />
                          )}
                        </button>
                      ) : (
                        <span className="text-[10px] text-neutral-600 font-bold uppercase italic px-2">Você</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

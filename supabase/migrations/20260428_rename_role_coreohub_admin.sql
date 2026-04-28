-- Renomeia o role de super admin de USUALDANCE_ADMIN para COREOHUB_ADMIN.
-- O nome anterior era um erro de nomenclatura da fase inicial do projeto.
-- coreohub@gmail.com é o admin da plataforma CoreoHub, sem relação com
-- a empresa Usualdance (que é apenas um cliente/contratante registrado).

-- 1. Remove o constraint antigo
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

-- 2. Recria incluindo COREOHUB_ADMIN (mantém USUALDANCE_ADMIN temporariamente para o UPDATE)
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN (
    'ORGANIZER', 'STUDIO_DIRECTOR', 'CHOREOGRAPHER', 'INDEPENDENT',
    'SUPPORT', 'JUDGE', 'TEAM', 'USER', 'TECHNICIAN', 'STAFF', 'SPECTATOR',
    'COORDENADOR', 'MESARIO', 'SONOPLASTA', 'RECEPCAO', 'PALCO',
    'USUALDANCE_ADMIN', 'COREOHUB_ADMIN'
  ));

-- 3. Migra o dado
UPDATE profiles SET role = 'COREOHUB_ADMIN' WHERE role = 'USUALDANCE_ADMIN';

-- 4. Remove USUALDANCE_ADMIN do constraint definitivamente
ALTER TABLE profiles DROP CONSTRAINT profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN (
    'ORGANIZER', 'STUDIO_DIRECTOR', 'CHOREOGRAPHER', 'INDEPENDENT',
    'SUPPORT', 'JUDGE', 'TEAM', 'USER', 'TECHNICIAN', 'STAFF', 'SPECTATOR',
    'COORDENADOR', 'MESARIO', 'SONOPLASTA', 'RECEPCAO', 'PALCO',
    'COREOHUB_ADMIN'
  ));

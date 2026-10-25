-- name: CountUsers :one
SELECT count(*) FROM users;
-- name: CreateUser :one
INSERT INTO users(id,email,name,password_hash,color) VALUES ($1,$2,$3,$4,$5) RETURNING *;
-- name: UserByEmail :one
SELECT * FROM users WHERE email=$1;
-- name: UserByID :one
SELECT id,email,name,color,created_at,avatar_data FROM users WHERE id=$1;
-- name: CreateTeam :one
INSERT INTO teams(id,name) VALUES ($1,$2) RETURNING *;
-- name: CreateMembership :exec
INSERT INTO memberships(team_id,user_id,role,display_name) VALUES ($1,$2,$3,(SELECT name FROM users WHERE id=$2));
-- name: Membership :one
SELECT * FROM memberships WHERE team_id=$1 AND user_id=$2;
-- name: UserTeams :many
SELECT teams.*,memberships.role,memberships.display_name FROM teams JOIN memberships ON teams.id=memberships.team_id WHERE memberships.user_id=$1 ORDER BY memberships.created_at,teams.id;
-- name: TeamByID :one
SELECT * FROM teams WHERE id=$1;
-- name: TeamMembers :many
SELECT users.id,COALESCE(NULLIF(memberships.display_name,''),users.name)::text AS name,users.color,users.avatar_data,memberships.role FROM users JOIN memberships ON users.id=memberships.user_id WHERE memberships.team_id=$1 ORDER BY memberships.created_at,users.id;
-- name: CreateSession :exec
INSERT INTO sessions(token_hash,user_id,team_id,expires_at) VALUES ($1,$2,$3,$4);
-- name: SessionIdentity :one
SELECT sessions.user_id,sessions.team_id,memberships.role FROM sessions JOIN memberships ON memberships.user_id=sessions.user_id AND memberships.team_id=sessions.team_id WHERE sessions.token_hash=$1 AND sessions.expires_at>now();
-- name: DeleteSession :exec
DELETE FROM sessions WHERE token_hash=$1;
-- name: SwitchSessionTeam :exec
UPDATE sessions SET team_id=$2 WHERE token_hash=$1;
-- name: CreateInvite :one
INSERT INTO invites(id,team_id,email,token_hash,created_by,expires_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,team_id,email,created_by,expires_at,used_at,revoked_at,created_at;
-- name: InviteByHash :one
SELECT invites.*,teams.name AS team_name,COALESCE(NULLIF(memberships.display_name,''),users.name)::text AS inviter_name FROM invites JOIN teams ON teams.id=invites.team_id JOIN users ON users.id=invites.created_by LEFT JOIN memberships ON memberships.team_id=invites.team_id AND memberships.user_id=invites.created_by WHERE token_hash=$1;
-- name: LockInvite :one
SELECT * FROM invites WHERE token_hash=$1 FOR UPDATE;
-- name: UseInvite :exec
UPDATE invites SET used_at=now() WHERE id=$1;
-- name: ListInvites :many
SELECT id,team_id,email,created_by,expires_at,used_at,revoked_at,created_at FROM invites WHERE team_id=$1 ORDER BY created_at DESC;
-- name: RevokeInvite :execrows
UPDATE invites SET revoked_at=now() WHERE id=$1 AND team_id=$2 AND used_at IS NULL;
-- name: CreateAgentToken :one
INSERT INTO agent_tokens(id,team_id,user_id,name,token_hash,prefix,scopes,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,name,prefix,scopes,expires_at,revoked_at,last_used_at,created_at;
-- name: TokenIdentity :one
SELECT agent_tokens.id,agent_tokens.user_id,agent_tokens.team_id,agent_tokens.scopes,memberships.role FROM agent_tokens JOIN memberships ON memberships.team_id=agent_tokens.team_id AND memberships.user_id=agent_tokens.user_id WHERE agent_tokens.token_hash=$1 AND agent_tokens.revoked_at IS NULL AND agent_tokens.expires_at>now();
-- name: TouchAgentToken :exec
UPDATE agent_tokens SET last_used_at=now() WHERE id=$1;
-- name: ListAgentTokens :many
SELECT id,name,prefix,scopes,expires_at,revoked_at,last_used_at,created_at FROM agent_tokens WHERE team_id=$1 AND user_id=$2 ORDER BY created_at DESC;
-- name: RevokeAgentToken :execrows
UPDATE agent_tokens SET revoked_at=now() WHERE id=$1 AND team_id=$2 AND user_id=$3;
-- name: CreateDefaultProject :exec
INSERT INTO projects(id,team_id,name) VALUES ('general',$1,'团队协作');
-- name: TeamProjects :many
SELECT * FROM projects WHERE team_id=$1 ORDER BY name;
-- name: CreateDomain :exec
INSERT INTO domains(team_id,name,position) VALUES ($1,$2,$3);
-- name: TeamDomains :many
SELECT name FROM domains WHERE team_id=$1 ORDER BY position,name;
-- name: DeleteMember :execrows
DELETE FROM memberships WHERE team_id=$1 AND user_id=$2 AND role<>'admin';
-- name: RevokeMemberTokens :exec
UPDATE agent_tokens SET revoked_at=now() WHERE team_id=$1 AND user_id=$2 AND revoked_at IS NULL;
-- name: DeleteMemberSessions :exec
DELETE FROM sessions WHERE team_id=$1 AND user_id=$2;

-- name: SetMemberDisplayName :exec
UPDATE memberships SET display_name=$3 WHERE team_id=$1 AND user_id=$2;

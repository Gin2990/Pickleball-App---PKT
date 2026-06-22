import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (import.meta as any).env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = (import.meta as any).env.VITE_SUPABASE_ANON_KEY || '';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export function handleSupabaseError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path
  };
  console.error('Supabase Error: ', JSON.stringify(errInfo));
  throw new Error(errInfo.error);
}

// Keep handleFirestoreError as alias for compatibility if needed
export const handleFirestoreError = handleSupabaseError;

// Authentication wrappers
export const loginWithEmail = async (email: string, pass: string) => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: pass,
  });
  if (error) throw error;
  return data;
};

export const registerWithEmail = async (email: string, pass: string) => {
  const { data, error } = await supabase.auth.signUp({
    email,
    password: pass,
  });
  if (error) throw error;
  return data;
};

export const logout = async () => {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
};

export const onAuthStateChanged = (authObj: any, callback: (user: any) => void) => {
  // Get initial session/user
  supabase.auth.getSession().then(({ data: { session } }) => {
    if (session?.user) {
      callback({
        ...session.user,
        uid: session.user.id,
      });
    } else {
      callback(null);
    }
  });

  const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
    if (session?.user) {
      callback({
        ...session.user,
        uid: session.user.id,
      });
    } else {
      callback(null);
    }
  });

  return () => {
    subscription.unsubscribe();
  };
};

export const auth = {
  get currentUser() {
    return null; // Not directly needed, auth status is handled in state listener
  }
};

// Realtime subscriptions
export function subscribeTournaments(onUpdate: (tournaments: any[]) => void) {
  // Fetch initial data
  const fetchAll = async () => {
    const { data, error } = await supabase
      .from('tournaments')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('Error fetching tournaments:', error);
      return;
    }
    
    const mapped = (data || []).map(t => ({
      id: t.id,
      name: t.name,
      stage: t.stage,
      createdAt: { toMillis: () => new Date(t.created_at).getTime() },
      ownerId: t.owner_id,
      organizerIds: t.organizer_ids,
      config: t.config
    }));
    onUpdate(mapped);
  };

  fetchAll();

  // Subscribe to changes on table
  const subscription = supabase
    .channel('public:tournaments')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tournaments' }, () => {
      fetchAll();
    })
    .subscribe();

  return () => {
    subscription.unsubscribe();
  };
}

export function subscribeTournamentDoc(tournamentId: string, onUpdate: (data: any) => void) {
  const fetchDoc = async () => {
    const { data, error } = await supabase
      .from('tournaments')
      .select('*')
      .eq('id', tournamentId)
      .maybeSingle();

    if (error) {
      console.error('Error fetching tournament doc:', error);
      return;
    }

    if (data) {
      onUpdate({
        id: data.id,
        name: data.name,
        stage: data.stage,
        createdAt: { toMillis: () => new Date(data.created_at).getTime() },
        ownerId: data.owner_id,
        organizerIds: data.organizer_ids,
        config: data.config
      });
    }
  };

  fetchDoc();

  const subscription = supabase
    .channel(`public:tournaments:id:${tournamentId}`)
    .on('postgres_changes', { 
      event: '*', 
      schema: 'public', 
      table: 'tournaments', 
      filter: `id=eq.${tournamentId}` 
    }, () => {
      fetchDoc();
    })
    .subscribe();

  return () => {
    subscription.unsubscribe();
  };
}

export function subscribeTeams(tournamentId: string, onUpdate: (teams: any[]) => void) {
  const fetchAll = async () => {
    const { data, error } = await supabase
      .from('teams')
      .select('*')
      .eq('tournament_id', tournamentId);

    if (error) {
      console.error('Error fetching teams:', error);
      return;
    }

    const mapped = (data || []).map(t => ({
      id: t.id,
      name: t.name,
      club: t.club
    }));
    onUpdate(mapped);
  };

  fetchAll();

  const subscription = supabase
    .channel(`public:teams:tournament:${tournamentId}`)
    .on('postgres_changes', { 
      event: '*', 
      schema: 'public', 
      table: 'teams', 
      filter: `tournament_id=eq.${tournamentId}` 
    }, () => {
      fetchAll();
    })
    .subscribe();

  return () => {
    subscription.unsubscribe();
  };
}

export function subscribeGroups(tournamentId: string, onUpdate: (groups: any[]) => void) {
  const fetchAll = async () => {
    const { data, error } = await supabase
      .from('groups')
      .select('*')
      .eq('tournament_id', tournamentId);

    if (error) {
      console.error('Error fetching groups:', error);
      return;
    }

    const mapped = (data || []).map(g => ({
      id: g.id,
      name: g.name,
      teamIds: g.team_ids
    }));
    onUpdate(mapped);
  };

  fetchAll();

  const subscription = supabase
    .channel(`public:groups:tournament:${tournamentId}`)
    .on('postgres_changes', { 
      event: '*', 
      schema: 'public', 
      table: 'groups', 
      filter: `tournament_id=eq.${tournamentId}` 
    }, () => {
      fetchAll();
    })
    .subscribe();

  return () => {
    subscription.unsubscribe();
  };
}

export function subscribeMatches(tournamentId: string, onUpdate: (matches: any[]) => void) {
  const fetchAll = async () => {
    const { data, error } = await supabase
      .from('matches')
      .select('*')
      .eq('tournament_id', tournamentId);

    if (error) {
      console.error('Error fetching matches:', error);
      return;
    }

    const mapped = (data || []).map(m => ({
      id: m.id,
      team1Id: m.team1_id,
      team2Id: m.team2_id,
      score1: m.score1,
      score2: m.score2,
      isCompleted: m.is_completed,
      stage: m.stage,
      groupId: m.group_id,
      round: m.round,
      nextMatchId: m.next_match_id
    }));
    onUpdate(mapped);
  };

  fetchAll();

  const subscription = supabase
    .channel(`public:matches:tournament:${tournamentId}`)
    .on('postgres_changes', { 
      event: '*', 
      schema: 'public', 
      table: 'matches', 
      filter: `tournament_id=eq.${tournamentId}` 
    }, () => {
      fetchAll();
    })
    .subscribe();

  return () => {
    subscription.unsubscribe();
  };
}

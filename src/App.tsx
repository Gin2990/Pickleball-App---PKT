/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Users, 
  Trophy, 
  LayoutDashboard, 
  Settings, 
  Plus, 
  FileUp, 
  ChevronRight,
  Play,
  LogIn,
  LogOut,
  GripVertical,
  ChevronLeft,
  Calendar,
  Search,
  RefreshCw
} from 'lucide-react';
import { Team, TournamentState, Group, Match, TournamentConfig, TournamentSummary } from './types.ts';
import { 
  DndContext, 
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  useDroppable
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { 
  db, 
  auth, 
  loginWithEmail,
  registerWithEmail,
  logout, 
  onAuthStateChanged, 
  handleFirestoreError,
  OperationType 
} from './firebase.ts';
import { 
  doc, 
  setDoc, 
  collection, 
  onSnapshot, 
  query, 
  writeBatch,
  deleteDoc,
  getDocs,
  serverTimestamp,
  getDoc
} from 'firebase/firestore';
import { Trash2 } from 'lucide-react';

interface SortableTeamItemProps {
  id: string;
  team: Team;
  key?: string;
}

const SortableTeamItem = ({ id, team }: SortableTeamItemProps) => {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="bg-white p-3 rounded-xl border border-slate-100 flex items-center gap-3 shadow-sm select-none cursor-grab active:cursor-grabbing hover:border-emerald-200 transition-colors">
      <GripVertical className="w-4 h-4 text-slate-300" />
      <div className="flex-1 overflow-hidden">
        <p className="text-xs font-black text-slate-700 truncate uppercase tracking-tighter">{team.name}</p>
      </div>
    </div>
  );
};

// Mock/Initial State for development
const INITIAL_STATE: TournamentState = {
  teams: [],
  groups: [],
  matches: [],
  stage: 'setup',
  config: {
    format: 'group-stage-knockout',
    teamsPerGroup: 4,
    advancingPerGroup: 2,
    knockoutSize: 4,
    knockoutPairing: 'auto',
    manualSlots: []
  },
  organizerIds: []
};

export default function App() {
  const [selectedTournamentId, setSelectedTournamentId] = useState<string | null>(null);
  const [tournaments, setTournaments] = useState<TournamentSummary[]>([]);
  const [state, setState] = useState<TournamentState>(INITIAL_STATE);
  const [activeTab, setActiveTab] = useState<'players' | 'groups' | 'bracket' | 'dashboard' | 'setup'>('dashboard');
  const [user, setUser] = useState<any>(null);
  const [loadingTournaments, setLoadingTournaments] = useState(true);
  const [loadingData, setLoadingData] = useState(false);
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [editingTeamName, setEditingTeamName] = useState('');

    const ADMIN_EMAILS = ['nguyenduclinhrin@gmail.com'];
    const isSystemAdmin = user && ADMIN_EMAILS.includes(user.email);
    const isOrganizer = !!user && (state.organizerIds?.includes(user.uid) || isSystemAdmin);

    const filteredNavItems = [
      { id: 'dashboard', icon: LayoutDashboard, label: 'Tổng quan' },
      { id: 'groups', icon: Trophy, label: 'Vòng bảng' },
      { id: 'bracket', icon: ChevronRight, label: 'Knockout' },
      ...(isOrganizer ? [
        { id: 'players', icon: Users, label: 'Đội thi đấu' },
        { id: 'setup', icon: Settings, label: 'Cấu hình' }
      ] : [])
    ];

  // --- Auth Sync ---
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (u) => {
      setUser(u);
    });
    return unsubscribeAuth;
  }, []);

  // --- Tournaments List Sync ---
  useEffect(() => {
    const q = query(collection(db, 'tournaments'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as TournamentSummary));
      setTournaments(list.sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0)));
      setLoadingTournaments(false);
    });
    return unsubscribe;
  }, []);

  // --- Selected Tournament Data Sync ---
  useEffect(() => {
    if (!selectedTournamentId) {
      setState(INITIAL_STATE);
      return;
    }

    // Only set loading for initial load
    if (state.teams.length === 0) {
      setLoadingData(true);
    }

    const tournamentDoc = onSnapshot(doc(db, 'tournaments', selectedTournamentId), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        setState(prev => ({ 
          ...prev, 
          stage: data.stage || 'setup',
          config: data.config || prev.config,
          organizerIds: data.organizerIds || []
        }));
      }
    });

    const teamsSub = onSnapshot(collection(db, 'tournaments', selectedTournamentId, 'teams'), (snapshot) => {
        const teams = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Team));
        setState(prev => {
          // Deep equal check to avoid redundant state updates and re-renders
          if (prev.teams.length === teams.length && 
              prev.teams.every((t, i) => t.id === teams[i].id && t.name === teams[i].name)) {
            return prev;
          }
          return { ...prev, teams };
        });
      });

      const groupsSub = onSnapshot(collection(db, 'tournaments', selectedTournamentId, 'groups'), (snapshot) => {
        const groups = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Group));
        setState(prev => {
          if (prev.groups.length === groups.length && 
              prev.groups.every((g, i) => g.id === groups[i].id && g.teamIds.length === groups[i].teamIds.length)) {
            return prev;
          }
          return { ...prev, groups };
        });
      });

      const matchesSub = onSnapshot(collection(db, 'tournaments', selectedTournamentId, 'matches'), (snapshot) => {
        const matches = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Match));
        setState(prev => {
          if (prev.matches.length === matches.length) {
            // Check if scores changed
            const changed = matches.some((m, i) => 
               m.score1 !== prev.matches[i].score1 || 
               m.score2 !== prev.matches[i].score2 ||
               m.isCompleted !== prev.matches[i].isCompleted
            );
            if (!changed) return prev;
          }
          return { ...prev, matches };
        });
        setLoadingData(false);
      });

    return () => {
      tournamentDoc();
      teamsSub();
      groupsSub();
      matchesSub();
    };
  }, [selectedTournamentId]);

  const updateMatchScore = async (matchId: string, s1: number, s2: number, isCompleted: boolean = true) => {
    if (!selectedTournamentId || !isOrganizer) return;
    try {
      await setDoc(doc(db, 'tournaments', selectedTournamentId, 'matches', matchId), { 
        score1: s1, 
        score2: s2, 
        isCompleted: isCompleted 
      }, { merge: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `tournaments/${selectedTournamentId}/matches/${matchId}`);
    }
  };

  const calculateGroupRankings = (groupId: string) => {
    const group = state.groups.find(g => g.id === groupId);
    if (!group) return [];

    const stats = group.teamIds.map(tId => {
      const teamMatches = state.matches.filter(m => m.groupId === groupId && (m.team1Id === tId || m.team2Id === tId));
      let wins = 0;
      let losses = 0;
      let points = 0;
      let setsWon = 0;
      let setsLost = 0;

      teamMatches.forEach(m => {
        if (!m.isCompleted) return;
        const isTeam1 = m.team1Id === tId;
        const teamScore = isTeam1 ? m.score1 : m.score2;
        const opponentScore = isTeam1 ? m.score2 : m.score1;

        if (teamScore > opponentScore) {
          wins++;
          points += 1;
        } else if (teamScore < opponentScore) {
          losses++;
        }
        setsWon += teamScore;
        setsLost += opponentScore;
      });

      const team = state.teams.find(t => t.id === tId);
      return {
        id: tId,
        name: team ? team.name : 'Unknown Team',
        played: teamMatches.filter(m => m.isCompleted).length,
        wins,
        losses,
        points,
        setsWon,
        setsLost,
        diff: setsWon - setsLost
      };
    });

    return stats.sort((a, b) => b.points - a.points || b.diff - a.diff || b.setsWon - a.setsWon);
  };

  const advanceToKnockout = async (assignedLuckyTeams: Record<string, string> = {}) => {
    const config = state.config;
    const matches: Match[] = [];
    
    const getTeamBySlot = (slot: string) => {
      if (slot.startsWith('Lucky')) {
        return assignedLuckyTeams[slot] || null;
      }
      if (slot.startsWith('Winner')) {
        return null; // Teams for later rounds are assigned during progression
      }
      const rank = parseInt(slot[0]);
      const groupLetter = slot.slice(1);
      const group = state.groups.find(g => g.name.endsWith(groupLetter) || g.id.endsWith(groupLetter));
      if (!group) return null;
      const rankings = calculateGroupRankings(group.id);
      return rankings[rank - 1]?.id || null;
    };

    try {
      const batch = writeBatch(db);
      
      if (config.knockoutPairing === 'manual' && config.manualSlots) {
        // config.manualSlots.length / 2 is the total count of matches configured manually
        for (let i = 0; i < config.manualSlots.length; i += 2) {
          const t1Id = getTeamBySlot(config.manualSlots[i]);
          const t2Id = getTeamBySlot(config.manualSlots[i+1]);
          const matchId = `KO-${i/2}`;
          
          batch.set(doc(db, 'tournaments', selectedTournamentId!, 'matches', matchId), {
            id: matchId,
            team1Id: t1Id,
            team2Id: t2Id,
            score1: 0,
            score2: 0,
            isCompleted: false,
            stage: 'knockout'
          });
        }
        // Also create the final match if it's not in manualSlots
        const totalMatches = config.knockoutSize - 1;
        const configuredMatches = config.manualSlots.length / 2;
        if (configuredMatches < totalMatches) {
          const finalMatchId = `KO-${totalMatches - 1}`;
          batch.set(doc(db, 'tournaments', selectedTournamentId!, 'matches', finalMatchId), {
            id: finalMatchId,
            team1Id: null,
            team2Id: null,
            score1: 0,
            score2: 0,
            isCompleted: false,
            stage: 'knockout'
          });
        }
      } else {
        // Automatic pairing logic
        const qualifiers: { teamId: string; rank: number; groupLetter: string }[] = [];
        state.groups.forEach(g => {
          const rankings = calculateGroupRankings(g.id);
          const letter = g.name.split(' ')[1] || g.id;
          rankings.slice(0, 2).forEach((r, idx) => {
            qualifiers.push({ teamId: r.id, rank: idx + 1, groupLetter: letter });
          });
        });

        // Simple default: 1A vs 2B, 1B vs 2A, etc.
        const rank1s = qualifiers.filter(q => q.rank === 1);
        const rank2s = qualifiers.filter(q => q.rank === 2);
        
        rank1s.forEach((r1, idx) => {
          const r2 = rank2s[(idx + 1) % rank2s.length];
          if (r1 && r2 && matches.length < config.knockoutSize / 2) {
            const matchId = `KO-${idx}`;
            batch.set(doc(db, 'tournaments', selectedTournamentId!, 'matches', matchId), {
              id: matchId,
              team1Id: r1.teamId,
              team2Id: r2.teamId,
              score1: 0,
              score2: 0,
              isCompleted: false,
              stage: 'knockout'
            });
          }
        });
      }

      batch.update(doc(db, 'tournaments', selectedTournamentId!), { stage: 'knockout' });
      await batch.commit();
      setActiveTab('bracket');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `tournaments/${selectedTournamentId}/knockout`);
    }
  };

  const advanceToNextRound = async (currentMatchIdx: number, s1: number, s2: number) => {
    if (!selectedTournamentId || !isOrganizer) return;

    const knockoutMatches = state.matches.filter(m => m.stage === 'knockout');
    const knockoutSize = state.config.knockoutSize;
    const sortedMatches = [...knockoutMatches].sort((a, b) => {
      const idxA = parseInt(a.id.split('-')[1]);
      const idxB = parseInt(b.id.split('-')[1]);
      return idxA - idxB;
    });

    const currentMatch = sortedMatches.find(m => m.id === `KO-${currentMatchIdx}`);
    if (!currentMatch) return;

    // Use passed scores instead of state to avoid race conditions with onSnapshot
    if (s1 === s2) {
      alert('Tỉ số hòa không được chấp nhận trong vòng trực tiếp. Vui lòng xác định người thắng.');
      return;
    }

    const winnerId = s1 > s2 ? currentMatch.team1Id : currentMatch.team2Id;
    const oldWinnerId = currentMatch.isCompleted 
      ? (currentMatch.score1 > currentMatch.score2 ? currentMatch.team1Id : (currentMatch.score2 > currentMatch.score1 ? currentMatch.team2Id : null)) 
      : null;

    try {
      const batch = writeBatch(db);
      
      // 1. Update current match
      batch.set(doc(db, 'tournaments', selectedTournamentId!, 'matches', currentMatch.id), {
        score1: s1,
        score2: s2,
        isCompleted: true,
        winnerId: winnerId
      }, { merge: true });

      let nextMatchIdx = -1;
      let slotInNextMatch = 1; // 1 or 2

      if (state.config.knockoutPairing === 'manual' && state.config.manualSlots) {
        // Find if any match in manualSlots uses the current match result as seed
        const sourceStr = `Winner KO-${currentMatchIdx}`;
        // Important: check all slots as one match output might be used in multiple places (rare but possible)
        state.config.manualSlots.forEach((slot, idx) => {
          if (slot === sourceStr) {
            nextMatchIdx = Math.floor(idx / 2);
            slotInNextMatch = (idx % 2) + 1;
            
            const nextMatchId = `KO-${nextMatchIdx}`;
            const nextMatch = sortedMatches.find(m => m.id === nextMatchId);
            const teamKey = slotInNextMatch === 1 ? 'team1Id' : 'team2Id';

            // Always update next match slot to current winner
            const nextMatchUpdate: any = {
              [teamKey]: winnerId
            };

            // If the winner changed (or it's a new completion), and next match is already completed, reset it
            if (nextMatch && nextMatch.isCompleted && winnerId !== oldWinnerId) {
              nextMatchUpdate.isCompleted = false;
              nextMatchUpdate.score1 = 0;
              nextMatchUpdate.score2 = 0;
            }

            if (nextMatch) {
              batch.update(doc(db, 'tournaments', selectedTournamentId!, 'matches', nextMatchId), nextMatchUpdate);
            } else {
              batch.set(doc(db, 'tournaments', selectedTournamentId!, 'matches', nextMatchId), {
                ...nextMatchUpdate,
                id: nextMatchId,
                score1: 0,
                score2: 0,
                isCompleted: false,
                stage: 'knockout'
              });
            }
          }
        });
        
        // Check for final match if not manually defined (standard progression)
        if (nextMatchIdx === -1) {
          if (knockoutSize === 4 && currentMatchIdx < 2) {
            nextMatchIdx = 2;
            slotInNextMatch = (currentMatchIdx % 2) + 1;
          } else if (knockoutSize === 8 && (currentMatchIdx === 4 || currentMatchIdx === 5)) {
            nextMatchIdx = 6;
            slotInNextMatch = (currentMatchIdx === 4 ? 1 : 2);
          } else if (knockoutSize === 16 && (currentMatchIdx === 12 || currentMatchIdx === 13)) {
            nextMatchIdx = 14;
            slotInNextMatch = (currentMatchIdx === 12 ? 1 : 2);
          }
          
          if (nextMatchIdx !== -1) {
            const nextMatchId = `KO-${nextMatchIdx}`;
            const nextMatch = sortedMatches.find(m => m.id === nextMatchId);
            const teamKey = slotInNextMatch === 1 ? 'team1Id' : 'team2Id';
            
            const nextMatchUpdate: any = { [teamKey]: winnerId };
            if (nextMatch && nextMatch.isCompleted && winnerId !== oldWinnerId) {
              nextMatchUpdate.isCompleted = false;
              nextMatchUpdate.score1 = 0;
              nextMatchUpdate.score2 = 0;
            }
            
            if (nextMatch) {
              batch.update(doc(db, 'tournaments', selectedTournamentId!, 'matches', nextMatchId), nextMatchUpdate);
            } else {
              batch.set(doc(db, 'tournaments', selectedTournamentId!, 'matches', nextMatchId), {
                ...nextMatchUpdate,
                id: nextMatchId,
                score1: 0,
                score2: 0,
                isCompleted: false,
                stage: 'knockout'
              });
            }
          }
        }
      } else {
        // Automatic hardcoded progression (same logic with update)
        if (knockoutSize === 4) {
          if (currentMatchIdx < 2) {
            nextMatchIdx = 2;
            slotInNextMatch = (currentMatchIdx % 2) + 1;
          }
        } else if (knockoutSize === 8) {
          if (currentMatchIdx < 4) {
            nextMatchIdx = 4 + Math.floor(currentMatchIdx / 2);
            slotInNextMatch = (currentMatchIdx % 2) + 1;
          } else if (currentMatchIdx < 6) {
            nextMatchIdx = 6;
            slotInNextMatch = (currentMatchIdx % 2) + 1;
          }
        } else if (knockoutSize === 16) {
          if (currentMatchIdx < 8) {
            nextMatchIdx = 8 + Math.floor(currentMatchIdx / 2);
            slotInNextMatch = (currentMatchIdx % 2) + 1;
          } else if (currentMatchIdx < 12) {
            nextMatchIdx = 12 + Math.floor((currentMatchIdx - 8) / 2);
            slotInNextMatch = (currentMatchIdx % 2) + 1;
          } else if (currentMatchIdx < 14) {
            nextMatchIdx = 14;
            slotInNextMatch = (currentMatchIdx % 2) + 1;
          }
        }
      }

      if (nextMatchIdx !== -1) {
        const nextMatchId = `KO-${nextMatchIdx}`;
        const nextMatch = sortedMatches.find(m => m.id === nextMatchId);
        const teamKey = slotInNextMatch === 1 ? 'team1Id' : 'team2Id';

        // If the winner changed (or it's a new completion), update the next match
        if (winnerId !== oldWinnerId) {
          const nextMatchUpdate: any = {
            [teamKey]: winnerId
          };

          // CRITICAL: If the next round match was already completed, we MUST reset it 
          // because the context (participating team) has changed.
          if (nextMatch && nextMatch.isCompleted) {
            nextMatchUpdate.isCompleted = false;
            nextMatchUpdate.score1 = 0;
            nextMatchUpdate.score2 = 0;
          }

          if (nextMatch) {
            batch.update(doc(db, 'tournaments', selectedTournamentId!, 'matches', nextMatchId), nextMatchUpdate);
          } else {
            // Create next match if it doesn't exist
            batch.set(doc(db, 'tournaments', selectedTournamentId!, 'matches', nextMatchId), {
              ...nextMatchUpdate,
              id: nextMatchId,
              score1: 0,
              score2: 0,
              isCompleted: false,
              stage: 'knockout'
            });
          }
        }
      }

      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `tournaments/${selectedTournamentId}/advance/${currentMatchIdx}`);
    }
  };


  // --- Views ---

  const addTeams = async (names: string[]) => {
    const newTeams: Team[] = names.map(name => {
      return {
        id: Math.random().toString(36).substr(2, 9),
        name: name.trim()
      };
    }).filter(t => t.name.length > 0);
    
    try {
      const batch = writeBatch(db);
      newTeams.forEach(t => {
        batch.set(doc(db, 'tournaments', selectedTournamentId!, 'teams', t.id), t);
      });
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `tournaments/${selectedTournamentId}/teams`);
    }
  };

  const removeTeam = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'tournaments', selectedTournamentId!, 'teams', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `tournaments/${selectedTournamentId}/teams/${id}`);
    }
  };

  const resetTournamentScores = async () => {
    if (!selectedTournamentId || !isOrganizer) return;
    if (!confirm('Bạn có chắc chắn muốn xóa toàn bộ kết quả đã nhập và bắt đầu lại từ đầu? Các trận vòng Knockout sẽ bị xóa hoàn toàn. Thao tác này không thể hoàn tác.')) return;

    setLoadingData(true);
    try {
      const batch = writeBatch(db);
      
      state.matches.forEach(match => {
        if (match.stage === 'group') {
          batch.update(doc(db, 'tournaments', selectedTournamentId, 'matches', match.id), {
            score1: 0,
            score2: 0,
            isCompleted: false
          });
        } else {
          batch.delete(doc(db, 'tournaments', selectedTournamentId, 'matches', match.id));
        }
      });

      batch.update(doc(db, 'tournaments', selectedTournamentId), {
        stage: state.matches.some(m => m.stage === 'group') ? 'group' : 'setup'
      });

      await batch.commit();
      alert('Đã reset toàn bộ kết quả giải đấu!');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `tournaments/${selectedTournamentId}/reset`);
    } finally {
      setLoadingData(false);
    }
  };

  const updateTeam = async (id: string, newName: string) => {
    if (!selectedTournamentId || !newName.trim()) {
      setEditingTeamId(null);
      return;
    }
    
    const team = state.teams.find(t => t.id === id);
    if (team && team.name === newName.trim()) {
      setEditingTeamId(null);
      return;
    }

    // Optimistic Update
    const oldTeams = [...state.teams];
    setState(prev => ({
      ...prev,
      teams: prev.teams.map(t => t.id === id ? { ...t, name: newName.trim() } : t)
    }));
    setEditingTeamId(null);

    try {
      await setDoc(doc(db, 'tournaments', selectedTournamentId, 'teams', id), {
        name: newName.trim()
      }, { merge: true });
    } catch (err) {
      // Revert if failed
      setState(prev => ({ ...prev, teams: oldTeams }));
      handleFirestoreError(err, OperationType.WRITE, `tournaments/${selectedTournamentId}/teams/${id}`);
    }
  };

  const generateGroups = async (teamsPerGroup: number = 4) => {
    const shuffled = [...state.teams].sort(() => Math.random() - 0.5);
    const groups: Group[] = [];
    const matches: Match[] = [];

    for (let i = 0; i < shuffled.length; i += teamsPerGroup) {
      const groupTeams = shuffled.slice(i, i + teamsPerGroup);
      const groupId = `G${Math.floor(i / teamsPerGroup) + 1}`;
      
      groups.push({
        id: groupId,
        name: `Bảng ${groupId.slice(1)}`,
        teamIds: groupTeams.map(t => t.id)
      });

      // Balanced Round-Robin Scheduling
      const teamIds = groupTeams.map(t => t.id);
      if (teamIds.length % 2 !== 0) teamIds.push('BYE');
      
      const n = teamIds.length;
      const rounds = n - 1;
      const matchesPerRound = n / 2;
      
      for (let round = 0; round < rounds; round++) {
        for (let j = 0; j < matchesPerRound; j++) {
          const t1Id = teamIds[j];
          const t2Id = teamIds[n - 1 - j];
          
          if (t1Id !== 'BYE' && t2Id !== 'BYE') {
            matches.push({
              id: `M-${groupId}-${round}-${j}`,
              team1Id: t1Id,
              team2Id: t2Id,
              score1: 0,
              score2: 0,
              isCompleted: false,
              stage: 'group',
              groupId: groupId
            });
          }
        }
        // Rotate teams (Circle Method)
        teamIds.splice(1, 0, teamIds.pop()!);
      }
    }

    try {
      const batch = writeBatch(db);
      groups.forEach(g => batch.set(doc(db, 'tournaments', selectedTournamentId!, 'groups', g.id), g));
      matches.forEach(m => batch.set(doc(db, 'tournaments', selectedTournamentId!, 'matches', m.id), m));
      batch.update(doc(db, 'tournaments', selectedTournamentId!), { stage: 'group' });
      await batch.commit();
      setActiveTab('groups');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `tournaments/${selectedTournamentId}/generate`);
    }
  };

  // --- Views ---

  const PlayerManagement = () => {
    const [input, setInput] = useState('');
    
    const handleImport = () => {
      const lines = input.split('\n').filter(n => n.trim());
      addTeams(lines);
      setInput('');
    };

    return (
      <div className="space-y-8">
        <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-200">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-sm font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                <FileUp className="w-4 h-4" />
                Nhập danh sách Đội / VĐV
              </h2>
              <p className="text-[10px] text-slate-400 mt-1 uppercase font-bold">Ghi tên vận động viên hoặc tên đội (Mỗi dòng một đội)</p>
            </div>
            <span className="text-[10px] font-bold text-slate-300">Tổng số: {state.teams.length}</span>
          </div>
          <textarea 
            className="w-full h-32 p-6 bg-slate-50 border-2 border-slate-100 rounded-2xl focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 outline-none transition-all font-mono text-sm resize-none"
            placeholder="Nguyễn Văn A&#10;Trần Thị B & Lê Văn C..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <div className="mt-6 flex justify-end">
            <button 
              onClick={handleImport}
              className="px-8 py-3 bg-slate-900 text-white rounded-xl font-black text-sm uppercase tracking-widest hover:bg-slate-800 transition-all flex items-center gap-3 active:scale-95 disabled:opacity-50"
              disabled={!input.trim()}
            >
              <Plus className="w-4 h-4" />
              Thêm Đội
            </button>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-4 px-2">
            <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest">Danh sách Đội ({state.teams.length})</h4>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {state.teams.map((team, idx) => (
              <div 
                key={team.id}
                className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4 group hover:border-emerald-200 transition-all"
              >
                <div className="w-10 h-10 rounded-xl bg-slate-50 text-slate-400 flex items-center justify-center font-black text-xs border border-slate-100 group-hover:bg-emerald-500 group-hover:text-white group-hover:border-emerald-500 transition-all shrink-0">
                  {idx + 1}
                </div>
                <div className="flex-1 overflow-hidden">
                  {editingTeamId === team.id ? (
                    <div className="flex gap-2">
                      <input 
                        autoFocus
                        type="text"
                        className="flex-1 p-1 px-2 bg-slate-50 border border-emerald-500 rounded font-bold text-xs outline-none"
                        value={editingTeamName}
                        onChange={(e) => setEditingTeamName(e.target.value)}
                        onBlur={() => {
                          // Only update if not already cleared by Enter/Esc
                          if (editingTeamId === team.id) updateTeam(team.id, editingTeamName);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            updateTeam(team.id, editingTeamName);
                          }
                          if (e.key === 'Escape') {
                            setEditingTeamId(null);
                          }
                        }}
                      />
                    </div>
                  ) : (
                    <>
                      <p className="font-bold text-slate-800 truncate tracking-tight">{team.name}</p>
                      <p className="text-[10px] text-slate-400 font-semibold tracking-tight">{team.club || 'Pickleball Pro'}</p>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                  <button 
                    onClick={() => {
                      setEditingTeamId(team.id);
                      setEditingTeamName(team.name);
                    }}
                    className="text-slate-400 hover:text-emerald-500 p-1"
                  >
                    <Settings className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={() => removeTeam(team.id)}
                    className="text-slate-200 hover:text-rose-500 p-1"
                  >
                    <Plus className="w-4 h-4 rotate-45" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {state.teams.length >= 4 && state.stage === 'setup' && (
          <div className="fixed bottom-12 left-1/2 -translate-x-1/2 z-50">
            <button 
              onClick={() => setActiveTab('setup')}
              className="px-10 py-5 bg-emerald-600 text-white rounded-full shadow-2xl shadow-emerald-200 font-black uppercase tracking-[0.2em] flex items-center gap-4 hover:scale-105 active:scale-95 transition-all text-sm border-4 border-white"
            >
              <Settings className="w-5 h-5" />
              Tiếp tục Thiết lập ({state.teams.length} Đội)
            </button>
          </div>
        )}
      </div>
    );
  };

  const TournamentSetup = () => {
    const [numGroups, setNumGroups] = useState(2);
    const [localGroups, setLocalGroups] = useState<Group[]>([]);
    const [knockoutSize, setKnockoutSize] = useState<4 | 8 | 16>(4);
    const [knockoutPairing, setKnockoutPairing] = useState<'auto' | 'manual'>('auto');
    
    const getManualSlotsSize = (size: number) => {
      return (size - 2) * 2;
    };

    const generateDefaultSlots = (size: number) => {
      const slots = [];
      const groups = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
      
      if (size === 4) {
        // BK: 2 matches (4 slots)
        slots.push('1A', '2B', '1B', '2A');
      } else if (size === 8) {
        // TK: 4 matches (8 slots)
        slots.push('1A', '2B', '1C', '2D', '1B', '2A', '1D', '2C');
        // BK: 2 matches (4 slots)
        slots.push('Winner KO-0', 'Winner KO-1', 'Winner KO-2', 'Winner KO-3');
      } else if (size === 16) {
        // 1/8: 8 matches (16 slots)
        for (let i = 0; i < 8; i++) {
          slots.push(`1${groups[i]}`, `2${groups[(i+1)%8]}`);
        }
        // TK: 4 matches (8 slots)
        for (let i = 0; i < 8; i++) slots.push(`Winner KO-${i}`);
        // BK: 2 matches (4 slots)
        for (let i = 8; i < 12; i++) slots.push(`Winner KO-${i}`);
      }
      return slots;
    };

    const [manualSlots, setManualSlots] = useState<string[]>(generateDefaultSlots(4));
    
    useEffect(() => {
      setManualSlots(generateDefaultSlots(knockoutSize));
    }, [knockoutSize, knockoutPairing]);

    const groupRankOptions = useMemo(() => {
      const options: string[] = [];
      localGroups.forEach(g => {
        const letter = g.name.split(' ')[1] || g.id;
        options.push(`1${letter}`, `2${letter}`, `3${letter}`);
      });
      options.push('Lucky1', 'Lucky2');
      return options;
    }, [localGroups]);

    useEffect(() => {
      // Auto-init groups if empty
      if (state.teams.length > 0 && localGroups.length === 0) {
        const teamsPerGroup = Math.ceil(state.teams.length / numGroups);
        const groups: Group[] = [];
        for (let i = 0; i < numGroups; i++) {
          groups.push({
            id: `G${i+1}`,
            name: `Bảng ${String.fromCharCode(65 + i)}`,
            teamIds: state.teams.slice(i * teamsPerGroup, (i + 1) * teamsPerGroup).map(t => t.id)
          });
        }
        setLocalGroups(groups);
      }
    }, [state.teams, numGroups]);

    const handleDragEnd = (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over) return;

      const activeId = active.id as string;
      const overId = over.id as string;

      const sourceGroup = localGroups.find(g => g.teamIds.includes(activeId));
      let targetGroup = localGroups.find(g => g.teamIds.includes(overId));
      
      if (!targetGroup) {
        targetGroup = localGroups.find(g => g.id === overId);
      }

      if (!sourceGroup || !targetGroup) return;

      if (sourceGroup.id === targetGroup.id) {
        if (activeId !== overId) {
          setLocalGroups(prev => prev.map(g => {
            if (g.id === sourceGroup.id) {
              const oldIndex = g.teamIds.indexOf(activeId);
              const newIndex = g.teamIds.indexOf(overId);
              return { ...g, teamIds: arrayMove(g.teamIds, oldIndex, newIndex) };
            }
            return g;
          }));
        }
      } else {
        setLocalGroups(prev => prev.map(g => {
          if (g.id === sourceGroup.id) {
            return { ...g, teamIds: g.teamIds.filter(id => id !== activeId) };
          }
          if (g.id === targetGroup.id) {
            const overIndex = g.teamIds.indexOf(overId);
            const shadowTeamIds = [...g.teamIds];
            if (overIndex >= 0) {
              shadowTeamIds.splice(overIndex, 0, activeId);
            } else {
              shadowTeamIds.push(activeId);
            }
            return { ...g, teamIds: shadowTeamIds };
          }
          return g;
        }));
      }
    };

    const confirmSetup = async () => {
      const matches: Match[] = [];
      localGroups.forEach(group => {
        const teamIds = [...group.teamIds];
        if (teamIds.length % 2 !== 0) teamIds.push('BYE');
        
        const n = teamIds.length;
        const rounds = n - 1;
        const matchesPerRound = n / 2;
        
        for (let round = 0; round < rounds; round++) {
          for (let i = 0; i < matchesPerRound; i++) {
            const t1Id = teamIds[i];
            const t2Id = teamIds[n - 1 - i];
            
            if (t1Id !== 'BYE' && t2Id !== 'BYE') {
              matches.push({
                id: `M-${group.id}-${round}-${i}`,
                team1Id: t1Id,
                team2Id: t2Id,
                score1: 0,
                score2: 0,
                isCompleted: false,
                stage: 'group',
                groupId: group.id
              });
            }
          }
          // Rotate teams (Circle Method)
          teamIds.splice(1, 0, teamIds.pop()!);
        }
      });

      try {
        const batch = writeBatch(db);
        localGroups.forEach(g => batch.set(doc(db, 'tournaments', selectedTournamentId!, 'groups', g.id), g));
        matches.forEach(m => batch.set(doc(db, 'tournaments', selectedTournamentId!, 'matches', m.id), m));
        batch.update(doc(db, 'tournaments', selectedTournamentId!), { 
          stage: 'group',
          config: {
            ...state.config,
            knockoutSize,
            knockoutPairing,
            manualSlots
          }
        });
        await batch.commit();
        setActiveTab('groups');
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `tournaments/${selectedTournamentId}/confirm-setup`);
      }
    };

    const GroupContainer = ({ group, children }: { group: Group; children: React.ReactNode; key?: string }) => {
      const { setNodeRef } = useDroppable({ id: group.id });
      return (
        <div ref={setNodeRef} className="bg-slate-100/50 p-6 rounded-3xl border-2 border-dashed border-slate-200 min-h-[200px]">
          <div className="flex justify-between items-center mb-6">
            <h3 className="font-black text-slate-800 uppercase tracking-[0.2em]">{group.name}</h3>
            <span className="text-[10px] font-black text-slate-400 uppercase">{group.teamIds.length} ĐỘI</span>
          </div>
          {children}
        </div>
      );
    };

    return (
      <div className="space-y-12">
        {/* Group Config */}
        <div className="space-y-6">
          <div className="bg-white p-8 rounded-3xl border border-slate-200 flex flex-wrap items-center justify-between gap-6">
            <div>
              <h2 className="text-xl font-black text-slate-800 uppercase tracking-tight">Cấu hình Vòng đấu bảng</h2>
              <p className="text-xs text-slate-500 font-bold uppercase tracking-widest mt-1">Kéo thả để sắp xếp đội vào bảng</p>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-xs font-black uppercase text-slate-400">Số bảng đấu:</span>
              <select 
                value={numGroups} 
                onChange={(e) => {
                  setNumGroups(parseInt(e.target.value));
                  setLocalGroups([]); // Trigger refresh
                }}
                className="bg-slate-50 border border-slate-100 p-2 rounded-lg font-black text-sm outline-none focus:ring-2 focus:ring-emerald-500"
              >
                {[2, 3, 4, 8].map(n => <option key={n} value={n}>{n} Bảng</option>)}
              </select>
            </div>
          </div>

          <DndContext 
            collisionDetection={closestCenter} 
            onDragEnd={handleDragEnd}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {localGroups.map(group => (
                <GroupContainer key={group.id} group={group}>
                  <SortableContext items={group.teamIds} strategy={verticalListSortingStrategy}>
                    <div className="space-y-2 min-h-[50px]">
                      {group.teamIds.map(tId => {
                        const team = state.teams.find(t => t.id === tId);
                        return team ? <SortableTeamItem key={tId} id={tId} team={team} /> : null;
                      })}
                    </div>
                  </SortableContext>
                </GroupContainer>
              ))}
            </div>
          </DndContext>
        </div>

        {/* Knockout Config */}
        <div className="bg-slate-900 p-10 rounded-[3rem] text-white space-y-10">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-8">
            <div className="space-y-2">
              <h2 className="text-3xl font-black uppercase tracking-tighter italic">Thể lệ Vòng Trực Tiếp</h2>
              <p className="text-slate-400 text-xs font-bold uppercase tracking-[0.2em]">Cấu hình cách phân nhánh sau khi kết thúc vòng bảng</p>
            </div>
            
            <div className="flex flex-wrap gap-10">
              <div className="space-y-3">
                <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Số đội vào vòng trong</label>
                <div className="flex gap-2">
                  {[4, 8, 16].map(size => (
                    <button
                      key={size}
                      onClick={() => setKnockoutSize(size as 4|8|16)}
                      className={`w-12 h-12 rounded-xl font-black text-sm transition-all ${
                        knockoutSize === size ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' : 'bg-white/5 text-slate-400 hover:bg-white/10'
                      }`}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Phương thức xếp cặp</label>
                <div className="flex gap-2 p-1 bg-white/5 rounded-xl">
                  {['auto', 'manual'].map(mode => (
                    <button
                      key={mode}
                      onClick={() => setKnockoutPairing(mode as 'auto'|'manual')}
                      className={`px-4 py-2 rounded-lg font-black text-[10px] uppercase tracking-wider transition-all ${
                        knockoutPairing === mode ? 'bg-white text-slate-900 shadow-xl' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {mode === 'auto' ? 'Tự động' : 'Bằng tay'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {knockoutPairing === 'manual' && (
            <div className="bg-white/5 rounded-3xl p-8 border border-white/10 space-y-12">
              <h3 className="text-xs font-black uppercase text-emerald-400 tracking-widest text-center">Thiết lập cặp đấu thủ công</h3>
              
              {/* Manual Setup Rounds */}
              {(() => {
                const rounds: { name: string; matchCount: number; startIndex: number; sourceMatches?: string[] }[] = [];
                if (knockoutSize === 16) {
                  rounds.push({ name: 'Vòng 1/8', matchCount: 8, startIndex: 0 });
                  rounds.push({ name: 'Vòng Tứ kết', matchCount: 4, startIndex: 16, sourceMatches: ['1/8-1', '1/8-2', '1/8-3', '1/8-4', '1/8-5', '1/8-6', '1/8-7', '1/8-8'] });
                  rounds.push({ name: 'Vòng Bán kết', matchCount: 2, startIndex: 24, sourceMatches: ['TK1', 'TK2', 'TK3', 'TK4'] });
                } else if (knockoutSize === 8) {
                  rounds.push({ name: 'Vòng Tứ kết', matchCount: 4, startIndex: 0 });
                  rounds.push({ name: 'Vòng Bán kết', matchCount: 2, startIndex: 8, sourceMatches: ['Tứ kết 1', 'Tứ kết 2', 'Tứ kết 3', 'Tứ kết 4'] });
                } else {
                  rounds.push({ name: 'Vòng Bán kết', matchCount: 2, startIndex: 0 });
                }

                return rounds.map((round, rIdx) => (
                  <div key={rIdx} className="space-y-6">
                    <div className="flex items-center gap-4">
                      <div className="h-px bg-white/10 flex-1" />
                      <h4 className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em]">{round.name}</h4>
                      <div className="h-px bg-white/10 flex-1" />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                      {Array(round.matchCount).fill(0).map((_, mIdx) => (
                        <div key={mIdx} className="space-y-4">
                          <div className="bg-white/5 p-4 rounded-2xl border border-white/5 flex flex-col gap-3">
                            <span className="text-[9px] font-black text-slate-500 uppercase">Match {round.startIndex / 2 + mIdx + 1}</span>
                            
                            {[0, 1].map(pos => (
                              <select 
                                key={pos}
                                value={manualSlots[round.startIndex + mIdx * 2 + pos]}
                                onChange={(e) => {
                                  const newSlots = [...manualSlots];
                                  newSlots[round.startIndex + mIdx * 2 + pos] = e.target.value;
                                  setManualSlots(newSlots);
                                }}
                                className="bg-slate-800 text-white rounded-lg p-2.5 text-[11px] font-bold outline-none focus:ring-1 focus:ring-emerald-500 border border-white/10"
                              >
                                {round.sourceMatches ? (
                                  round.sourceMatches.map((src, sIdx) => (
                                    <option key={sIdx} value={`Winner KO-${round.startIndex === 8 ? sIdx : (round.startIndex === 16 ? sIdx : (round.startIndex === 24 ? 8 + sIdx : sIdx))}`}>
                                      Thắng {src}
                                    </option>
                                  ))
                                ) : (
                                  groupRankOptions.map(opt => (
                                    <option key={opt} value={opt}>
                                      {opt.startsWith('Lucky') ? opt : `Vị trí ${opt}`}
                                    </option>
                                  ))
                                )}
                              </select>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ));
              })()}
            </div>
          )}
        </div>

        <div className="flex justify-center">
          <button 
            onClick={confirmSetup}
            className="px-12 py-6 bg-emerald-500 text-white rounded-full shadow-2xl shadow-emerald-500/20 font-black uppercase tracking-[0.3em] flex items-center gap-6 hover:scale-105 active:scale-95 transition-all text-base border-4 border-white"
          >
            Khởi tạo giải đấu
            <ChevronRight className="w-6 h-6" />
          </button>
        </div>
        
        {/* Organizer Management Section */}
        {isOrganizer && <OrganizerManagement />}
      </div>
    );
  };

  const GroupStageView = () => {
    const [showLuckySelector, setShowLuckySelector] = useState(false);
    const [luckyAssignments, setLuckyAssignments] = useState<Record<string, string>>({});

    const luckySlots = useMemo(() => {
      const slots = state.config.manualSlots || [];
      return slots.filter(s => s.startsWith('Lucky'));
    }, [state.config.manualSlots]);

    const potentialTeams = useMemo(() => {
      // Teams that are not definitely in (rank 1 or 2)
      const teams: { id: string; name: string }[] = [];
      state.groups.forEach(g => {
        const rankings = calculateGroupRankings(g.id);
        rankings.slice(2).forEach(r => {
          teams.push({ id: r.id, name: r.name });
        });
      });
      return teams;
    }, [state.groups]);

    const handleAdvance = () => {
      if (luckySlots.length > 0) {
        setShowLuckySelector(true);
      } else {
        advanceToKnockout();
      }
    };

    return (
      <div className="space-y-12">
        <AnimatePresence>
          {showLuckySelector && (
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/90 backdrop-blur-xl"
            >
              <div className="bg-white w-full max-w-lg rounded-[2.5rem] p-10 shadow-2xl space-y-8">
                <div className="space-y-2">
                  <h3 className="text-2xl font-black text-slate-900 uppercase italic tracking-tighter">Chọn đội Lucky Loser</h3>
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Gán đội cho các suất Lucky đã cấu hình</p>
                </div>

                <div className="space-y-6">
                  {luckySlots.map(slot => (
                    <div key={slot} className="space-y-3">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{slot}</label>
                      <select 
                        value={luckyAssignments[slot] || ''}
                        onChange={(e) => setLuckyAssignments(prev => ({ ...prev, [slot]: e.target.value }))}
                        className="w-full bg-slate-50 border-2 border-slate-100 p-4 rounded-2xl font-bold text-sm outline-none focus:border-emerald-500 transition-all"
                      >
                        <option value="">-- Chọn đội --</option>
                        {potentialTeams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </div>
                  ))}
                </div>

                <div className="flex gap-4">
                  <button 
                    onClick={() => setShowLuckySelector(false)}
                    className="flex-1 py-4 text-slate-400 font-black uppercase text-xs tracking-widest hover:text-slate-600"
                  >
                    Hủy
                  </button>
                  <button 
                    onClick={() => advanceToKnockout(luckyAssignments)}
                    className="flex-[2] py-4 bg-emerald-600 text-white rounded-2xl font-black uppercase text-xs tracking-widest shadow-xl shadow-emerald-500/20"
                  >
                    Xác nhận & Phân nhánh
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {state.groups.map(group => {
            return (
              <div key={group.id} className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden flex flex-col transition-all hover:shadow-md">
                <GroupStandingsTable groupId={group.id} />
                <div className="p-6 bg-slate-50/50 border-t border-slate-100">
                  <h4 className="text-[10px] font-black uppercase text-slate-400 mb-4 tracking-[0.2em] flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping"></span>
                    Cập nhật kết quả trực tiếp
                  </h4>
                  <div className="space-y-3">
                    {state.matches.filter(m => m.groupId === group.id).map(match => {
    const t1 = state.teams.find(t => t.id === match.team1Id);
    const t2 = state.teams.find(t => t.id === match.team2Id);
    return (
      <div key={match.id} className="bg-white border border-slate-200 p-3 md:p-4 rounded-2xl flex flex-col gap-3 shadow-sm group hover:border-emerald-300 transition-all">
        <div className="flex items-center justify-between gap-3 md:gap-4">
          <div className="flex-1 text-right text-[11px] md:text-[13px] font-semibold text-slate-700 tracking-tight line-clamp-2 leading-tight py-1">
            {t1 ? t1.name : 'Chưa xác định'}
          </div>
          <div className="flex items-center gap-2 md:gap-3 shrink-0">
             <div className="flex items-center gap-1 md:gap-2">
              <input 
                id={`s1-${match.id}`}
                type="number"
                defaultValue={match.score1}
                disabled={!isOrganizer}
                className="w-10 h-8 md:w-12 md:h-10 text-center border-2 border-slate-100 rounded-lg md:rounded-xl font-black text-sm md:text-xl focus:border-emerald-500 outline-none bg-slate-50 disabled:opacity-50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <span className="text-slate-200 font-black">:</span>
              <input 
                id={`s2-${match.id}`}
                type="number"
                defaultValue={match.score2}
                disabled={!isOrganizer}
                className="w-10 h-8 md:w-12 md:h-10 text-center border-2 border-slate-100 rounded-lg md:rounded-xl font-black text-sm md:text-xl focus:border-emerald-500 outline-none bg-slate-50 disabled:opacity-50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
          </div>
          <div className="flex-1 text-left text-[11px] md:text-[13px] font-semibold text-slate-700 tracking-tight line-clamp-2 leading-tight py-1">
            {t2?.name}
          </div>
        </div>
                          
                          {isOrganizer && (
                            <button 
                              onClick={() => {
                                const s1 = parseInt((document.getElementById(`s1-${match.id}`) as HTMLInputElement).value) || 0;
                                const s2 = parseInt((document.getElementById(`s2-${match.id}`) as HTMLInputElement).value) || 0;
                                updateMatchScore(match.id, s1, s2, true);
                              }}
                              className={`w-full py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${
                                match.isCompleted 
                                  ? 'bg-slate-100 text-slate-500 hover:bg-emerald-50 hover:text-emerald-600' 
                                  : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-500 hover:text-white'
                              }`}
                            >
                              <Play className="w-3 h-3 fill-current" />
                              {match.isCompleted ? 'Cập nhật lại tỉ số' : 'Xác nhận tỉ số'}
                            </button>
                          )}
                          
                          {!isOrganizer && match.isCompleted && (
                            <div className="text-center">
                              <span className="px-3 py-1 bg-emerald-50 text-emerald-600 rounded-full text-[8px] font-black uppercase tracking-widest">
                                Trận đấu đã kết thúc
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {state.stage === 'group' && (
          <div className="flex justify-center p-8">
            <button 
              onClick={handleAdvance}
              className="px-10 py-4 bg-slate-900 text-white rounded-full shadow-2xl shadow-slate-200 font-black uppercase tracking-[0.2em] flex items-center gap-4 hover:scale-105 active:scale-95 transition-all text-sm border-4 border-white"
            >
              Chốt kết quả & Phân nhánh KO
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        )}
      </div>
    );
  };

  const BracketMatchItem = React.memo(({ match, teams, matchIdx, knockoutSize, onUpdateScore }: { match: Match; teams: Team[]; matchIdx: number; knockoutSize: number, onUpdateScore: (id: string, s1: number, s2: number) => void }) => {
    const t1 = teams.find(t => t.id === match.team1Id);
    const t2 = teams.find(t => t.id === match.team2Id);
    const [s1, setS1] = useState(match.score1);
    const [s2, setS2] = useState(match.score2);

    useEffect(() => {
      setS1(match.score1);
      setS2(match.score2);
    }, [match.score1, match.score2]);
    
    const getStageName = (idx: number) => {
      if (knockoutSize === 4) return idx < 2 ? `Bán kết ${idx + 1}` : 'Chung kết';
      if (knockoutSize === 8) {
        if (idx < 4) return `Tứ kết ${idx + 1}`;
        if (idx < 6) return `Bán kết ${idx - 3}`;
        return 'Chung kết';
      }
      if (knockoutSize === 16) {
        if (idx < 8) return `Vòng 1/8 - Trận ${idx + 1}`;
        if (idx < 12) return `Tứ kết ${idx - 7}`;
        if (idx < 14) return `Bán kết ${idx - 11}`;
        return 'Chung kết';
      }
      return `Trận ${idx + 1}`;
    };

    const getPlaceholder = (mIdx: number, teamPos: 1 | 2) => {
      if (state.stage === 'setup') return 'Đang chờ...';
      
      const config = state.config;
      const knockoutSize = config.knockoutSize;
      const isAuto = config.knockoutPairing === 'auto';

      // Match indexing logic based on advanceToNextRound
      if (knockoutSize === 4) {
        if (mIdx === 2) return `Thắng Bán kết ${teamPos}`;
      } else if (knockoutSize === 8) {
        if (mIdx >= 4 && mIdx <= 5) {
          const prevMatchIdx = (mIdx - 4) * 2 + (teamPos - 1);
          return `Thắng Tứ kết ${prevMatchIdx + 1}`;
        }
        if (mIdx === 6) return `Thắng Bán kết ${teamPos}`;
      } else if (knockoutSize === 16) {
        if (mIdx >= 8 && mIdx <= 11) {
          const prevMatchIdx = (mIdx - 8) * 2 + (teamPos - 1);
          return `Thắng Vòng 1/8 trận ${prevMatchIdx + 1}`;
        }
        if (mIdx >= 12 && mIdx <= 13) {
          const prevMatchIdx = (mIdx - 12) * 2 + (teamPos - 1);
          // 4 Tứ kết: 8, 9, 10, 11
          return `Thắng Tứ kết ${prevMatchIdx + 1}`;
        }
        if (mIdx === 14) return `Thắng Bán kết ${teamPos}`;
      }

      const groups = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
      
      if (isAuto) {
        if (knockoutSize === 4) {
          if (mIdx === 0) return teamPos === 1 ? 'Nhất bảng A' : 'Nhì bảng B';
          if (mIdx === 1) return teamPos === 1 ? 'Nhất bảng B' : 'Nhì bảng A';
        }
        if (knockoutSize === 8) {
          if (mIdx === 0) return teamPos === 1 ? 'Nhất bảng A' : 'Nhì bảng B';
          if (mIdx === 1) return teamPos === 1 ? 'Nhất bảng C' : 'Nhì bảng D';
          if (mIdx === 2) return teamPos === 1 ? 'Nhất bảng B' : 'Nhì bảng A';
          if (mIdx === 3) return teamPos === 1 ? 'Nhất bảng D' : 'Nhì bảng C';
        }
        if (knockoutSize === 16) {
           if (mIdx % 2 === 0) return teamPos === 1 ? `Nhất bảng ${groups[mIdx]}` : `Nhì bảng ${groups[mIdx+1]}`;
           return teamPos === 1 ? `Nhất bảng ${groups[mIdx]}` : `Nhì bảng ${groups[mIdx-1]}`;
        }
      } else {
        return `Vị trí ${mIdx * 2 + teamPos}`;
      }
      
      return 'Đang chờ...';
    };

    return (
      <div className="flex flex-col w-[260px] flex-shrink-0 group">
        <div className="bg-white border-2 border-slate-100 rounded-2xl shadow-sm overflow-hidden hover:border-emerald-500 transition-all flex flex-col">
          <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
            <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">{getStageName(matchIdx)}</span>
            {match.isCompleted && (
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            )}
          </div>
          <div className="p-4 space-y-3">
            {/* Team 1 */}
            <div className={`flex items-center justify-between gap-2 p-2 rounded-xl transition-all ${match.score1 > match.score2 && match.isCompleted ? 'bg-emerald-50 ring-1 ring-emerald-100' : ''}`}>
              <div className="flex items-center gap-2 overflow-hidden flex-1">
                <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-[9px] font-black shrink-0 ${match.score1 > match.score2 && match.isCompleted ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-400'}`}>
                  1
                </div>
                <span className={`font-bold tracking-tight text-[11px] md:text-xs leading-tight flex-1 line-clamp-2 my-1.5 ${match.score1 > match.score2 && match.isCompleted ? 'text-emerald-700' : 'text-slate-700'}`}>
                  {t1 ? t1.name : <span className="opacity-40 italic">{getPlaceholder(matchIdx, 1)}</span>}
                </span>
              </div>
              <input 
                type="number"
                value={s1}
                onChange={(e) => setS1(parseInt(e.target.value) || 0)}
                disabled={!t1 || !isOrganizer}
                className="w-10 h-8 text-center border border-slate-100 rounded-lg font-black text-sm focus:border-emerald-500 outline-none bg-slate-50 disabled:opacity-50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>

            <div className="h-px bg-slate-50 w-full" />

            {/* Team 2 */}
            <div className={`flex items-center justify-between gap-2 p-2 rounded-xl transition-all ${match.score2 > match.score1 && match.isCompleted ? 'bg-emerald-50 ring-1 ring-emerald-100' : ''}`}>
              <div className="flex items-center gap-2 overflow-hidden flex-1">
                <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-[9px] font-black shrink-0 ${match.score2 > match.score1 && match.isCompleted ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-400'}`}>
                  2
                </div>
                <span className={`font-bold tracking-tight text-[11px] md:text-xs leading-tight flex-1 line-clamp-2 my-1.5 ${match.score2 > match.score1 && match.isCompleted ? 'text-emerald-700' : 'text-slate-700'}`}>
                  {t2 ? t2.name : <span className="opacity-40 italic">{getPlaceholder(matchIdx, 2)}</span>}
                </span>
              </div>
              <input 
                type="number"
                value={s2}
                onChange={(e) => setS2(parseInt(e.target.value) || 0)}
                disabled={!t2 || !isOrganizer}
                className="w-10 h-8 text-center border border-slate-100 rounded-lg font-black text-sm focus:border-emerald-500 outline-none bg-slate-50 disabled:opacity-50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
          </div>
          
          {isOrganizer && (
            match.isCompleted ? (
              <button 
                onClick={() => updateMatchScore(match.id, match.score1, match.score2, false)}
                className="w-full bg-slate-100 text-slate-500 py-3 text-[9px] font-black uppercase tracking-widest hover:bg-emerald-50 hover:text-emerald-600 transition-all flex items-center justify-center gap-2"
              >
                <Settings className="w-3 h-3" />
                Sửa lại kết quả
              </button>
            ) : (
              t1 && t2 && (
                <button 
                  onClick={() => {
                    advanceToNextRound(matchIdx, s1, s2);
                  }}
                  className="bg-emerald-600 text-white py-3 text-[9px] font-black uppercase tracking-widest hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2"
                >
                  <Play className="w-3 h-3 fill-current" />
                  Xác nhận kết quả
                </button>
              )
            )
          )}
        </div>
      </div>
    );
  });

  const BracketView = () => {
    const knockoutMatches = state.matches.filter(m => m.stage === 'knockout');
    const knockoutSize = state.config.knockoutSize;
    
    const rounds = useMemo(() => {
      const allRounds: Match[][] = [];
      if (knockoutSize === 4) {
        allRounds.push(knockoutMatches.filter(m => parseInt(m.id.split('-')[1]) < 2)); // SF
        allRounds.push(knockoutMatches.filter(m => parseInt(m.id.split('-')[1]) === 2)); // F
      } else if (knockoutSize === 8) {
        allRounds.push(knockoutMatches.filter(m => parseInt(m.id.split('-')[1]) < 4)); // QF
        allRounds.push(knockoutMatches.filter(m => parseInt(m.id.split('-')[1]) >= 4 && parseInt(m.id.split('-')[1]) < 6)); // SF
        allRounds.push(knockoutMatches.filter(m => parseInt(m.id.split('-')[1]) === 6)); // F
      } else if (knockoutSize === 16) {
        allRounds.push(knockoutMatches.filter(m => parseInt(m.id.split('-')[1]) < 8)); // R16
        allRounds.push(knockoutMatches.filter(m => parseInt(m.id.split('-')[1]) >= 8 && parseInt(m.id.split('-')[1]) < 12)); // QF
        allRounds.push(knockoutMatches.filter(m => parseInt(m.id.split('-')[1]) >= 12 && parseInt(m.id.split('-')[1]) < 14)); // SF
        allRounds.push(knockoutMatches.filter(m => parseInt(m.id.split('-')[1]) === 14)); // F
      }
      return allRounds;
    }, [knockoutMatches, knockoutSize]);

    const getRoundTitle = (idx: number) => {
      const totalRounds = rounds.length;
      if (idx === totalRounds - 1) return 'Chung kết';
      if (idx === totalRounds - 2) return 'Bán kết';
      if (idx === totalRounds - 3) return 'Tứ kết';
      return 'Vòng 1/8';
    };

    return (
      <div className="w-full h-full overflow-x-auto pb-12">
        <div className="flex gap-16 min-w-max p-8 items-center h-full">
          {rounds.map((roundMatches, roundIdx) => (
            <div key={roundIdx} className="flex flex-col gap-12 items-center">
              <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] bg-white border border-slate-200 px-4 py-1.5 rounded-full shadow-sm mb-4">
                {getRoundTitle(roundIdx)}
              </h4>
              <div className="flex flex-col gap-12 justify-around h-full">
                {roundMatches.sort((a,b) => parseInt(a.id.split('-')[1]) - parseInt(b.id.split('-')[1])).map((match) => (
                  <div key={match.id} className="relative flex items-center">
                    <BracketMatchItem 
                      match={match} 
                      teams={state.teams} 
                      matchIdx={parseInt(match.id.split('-')[1])}
                      knockoutSize={knockoutSize}
                      onUpdateScore={(id, s1, s2) => updateMatchScore(id, s1, s2, false)}
                    />
                    {/* Connector lines to next round */}
                    {roundIdx < rounds.length - 1 && (
                      <>
                        <div className="absolute -right-8 w-8 h-px bg-slate-200" />
                        <div className={`absolute -right-16 w-px h-[calc(50%+24px)] bg-slate-200 ${parseInt(match.id.split('-')[1]) % 2 === 0 ? 'top-1/2' : 'bottom-1/2'}`} />
                        {parseInt(match.id.split('-')[1]) % 2 === 0 && (
                          <div className="absolute -right-16 top-[calc(100%+36px)] w-8 h-px bg-slate-200" />
                        )}
                      </>
                    )}
                  </div>
                ))}
                {/* Empty slots for visual consistency if matches not created yet */}
                {roundMatches.length === 0 && Array(Math.pow(2, rounds.length - 1 - roundIdx)).fill(0).map((_, i) => (
                  <div key={i} className="w-[260px] h-32 border-2 border-dashed border-slate-100 rounded-2xl flex items-center justify-center">
                    <span className="text-[10px] font-black text-slate-200 uppercase tracking-widest italic">Chưa xác định</span>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {knockoutMatches.length === 0 && (
             <div className="w-full text-center text-slate-400 font-bold italic py-32 bg-slate-50 rounded-[3rem] border-4 border-dashed border-slate-100 px-20">
               <Trophy className="w-16 h-16 mx-auto mb-6 opacity-10" />
               <p className="uppercase tracking-[0.2em] text-sm">Vui lòng hoàn thành vòng bảng để bắt đầu vòng Knockout.</p>
             </div>
          )}
        </div>
      </div>
    );
  };

  const deleteTournament = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) return;
    const tournament = tournaments.find(t => t.id === id);
    if (!tournament || (tournament.ownerId !== user.uid && !isSystemAdmin)) {
      alert('Bạn không có quyền xóa giải đấu này.');
      return;
    }

    if (!confirm('Bạn có chắc chắn muốn xóa giải đấu này? Hành động này không thể hoàn tác.')) {
      return;
    }

    try {
      const batch = writeBatch(db);
      
      // Fetch subcollections to delete them (Firestore client-side requires manual deletion of subcollections)
      const [teamsSnap, groupsSnap, matchesSnap] = await Promise.all([
        getDocs(collection(db, 'tournaments', id, 'teams')),
        getDocs(collection(db, 'tournaments', id, 'groups')),
        getDocs(collection(db, 'tournaments', id, 'matches'))
      ]);

      teamsSnap.forEach(d => batch.delete(d.ref));
      groupsSnap.forEach(d => batch.delete(d.ref));
      matchesSnap.forEach(d => batch.delete(d.ref));
      batch.delete(doc(db, 'tournaments', id));

      await batch.commit();
      
      if (selectedTournamentId === id) {
        setSelectedTournamentId(null);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `tournaments/${id}`);
    }
  };

  const TournamentSelection = () => {
    const [newTournamentName, setNewTournamentName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isRegistering, setIsRegistering] = useState(false);
    const [authLoading, setAuthLoading] = useState(false);
    const [showLogin, setShowLogin] = useState(false);

    const handleAuth = async () => {
      if (!email || !password) return;
      setAuthLoading(true);
      try {
        if (isRegistering) {
          await registerWithEmail(email, password);
        } else {
          await loginWithEmail(email, password);
        }
      } catch (err: any) {
        alert('Lỗi: ' + err.message);
      } finally {
        setAuthLoading(false);
      }
    };

    const createTournament = async () => {
      if (!newTournamentName.trim() || !user) return;
      const id = Math.random().toString(36).substr(2, 9);
      try {
        await setDoc(doc(db, 'tournaments', id), {
          name: newTournamentName,
          stage: 'setup',
          createdAt: serverTimestamp(),
          ownerId: user.uid,
          organizerIds: [user.uid],
          config: INITIAL_STATE.config
        });
        setNewTournamentName('');
        setSelectedTournamentId(id);
        setActiveTab('dashboard');
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `tournaments/${id}`);
      }
    };

    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-indigo-50 via-slate-50 to-emerald-50 text-slate-900">
        <div className="max-w-4xl w-full space-y-12">
          <div className="text-center space-y-4">
            <div className="inline-flex items-center gap-3 px-4 py-2 bg-white rounded-full shadow-sm border border-slate-200">
              <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>    
            </div>
            <h1 className="text-4xl md:text-6xl font-black uppercase tracking-tighter italic leading-tight">
              Quản Lý Giải Đấu <br /> <span className="text-emerald-600">Pickleball</span>
            </h1>
           </div>

          <div className="max-w-2xl mx-auto w-full space-y-8">
            <div className="bg-white p-6 md:p-10 rounded-3xl md:rounded-[3rem] shadow-xl shadow-indigo-900/5 border border-slate-100 flex flex-col space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-[10px] md:text-sm font-black text-slate-400 uppercase tracking-widest">Các giải đang diễn ra</h3>
                {!user && (
                    <button 
                      onClick={() => setShowLogin(!showLogin)}
                      className="text-[10px] font-black text-indigo-600 uppercase tracking-widest hover:underline"
                    >
                      Đăng nhập
                    </button>
                )}
              </div>
              
              <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                {tournaments.map(t => (
                  <div 
                    key={t.id}
                    onClick={() => {
                      setSelectedTournamentId(t.id);
                      setActiveTab('dashboard');
                    }}
                    className="w-full p-6 bg-slate-50 rounded-3xl border border-slate-100 flex items-center justify-between group hover:border-emerald-500 hover:bg-emerald-50/30 transition-all text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="w-12 h-12 bg-white rounded-2xl border border-slate-200 flex items-center justify-center text-emerald-500 shadow-sm group-hover:scale-110 transition-transform shrink-0">
                        <Trophy className="w-6 h-6" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-black text-slate-800 uppercase tracking-tight truncate">{t.name}</p>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">
                          {t.stage === 'setup' ? 'Đang chuẩn bị' : t.stage === 'group' ? 'Vòng bảng' : 'Knockout'}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-emerald-500 transition-colors" />
                      {user && (t.ownerId === user.uid || isSystemAdmin) && (
                        <button 
                          onClick={(e) => deleteTournament(t.id, e)}
                          className="p-2 text-slate-300 hover:text-rose-500 transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {!loadingTournaments && tournaments.length === 0 && (
                  <div className="py-12 text-center space-y-4">
                    <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto text-slate-200">
                      <Search className="w-8 h-8" />
                    </div>
                    <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">Chưa có dữ liệu giải đấu</p>
                  </div>
                )}
              </div>
            </div>

            {/* Admin Section */}
            {(user || showLogin) && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-slate-900 p-8 md:p-10 rounded-[2.5rem] md:rounded-[3rem] shadow-2xl space-y-6 text-white"
              >
                {!user ? (
                   <div className="space-y-6">
                      <div className="flex items-center justify-between">
                         <h4 className="text-sm font-black uppercase tracking-widest text-emerald-400">
                           {isRegistering ? 'Đăng ký tài khoản' : 'Đăng nhập'}
                         </h4>
                         <button onClick={() => setShowLogin(false)} className="text-white/40 hover:text-white">
                           <Plus className="rotate-45 w-5 h-5" />
                         </button>
                      </div>
                      <div className="space-y-4">
                        <input 
                          type="email" 
                          placeholder="Email..."
                          className="w-full p-4 bg-white/5 border border-white/10 rounded-xl outline-none focus:border-emerald-500 transition-all font-bold text-sm"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                        />
                        <input 
                          type="password" 
                          placeholder="Mật khẩu..."
                          className="w-full p-4 bg-white/5 border border-white/10 rounded-xl outline-none focus:border-emerald-500 transition-all font-bold text-sm"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                        />
                      </div>
                      <button 
                        onClick={handleAuth}
                        disabled={authLoading}
                        className="w-full py-4 bg-emerald-500 text-white rounded-xl font-black uppercase text-xs tracking-widest hover:bg-emerald-600 transition-all flex items-center justify-center gap-3 disabled:opacity-50"
                      >
                        {authLoading ? (
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        ) : (
                          <LogIn className="w-4 h-4" />
                        )}
                        {isRegistering ? 'Tạo tài khoản' : 'Đăng nhập'}
                      </button>
                      <button 
                        onClick={() => setIsRegistering(!isRegistering)}
                        className="w-full text-center text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 hover:text-white transition-colors"
                      >
                        {isRegistering ? 'Đã có tài khoản? Đăng nhập' : 'Chưa có tài khoản? Đăng ký ngay'}
                      </button>
                   </div>
                ) : (
                  <div className="space-y-6">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-emerald-500 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-500/20 shrink-0">
                        <Plus className="w-6 h-6 text-white" />
                      </div>
                      <div className="space-y-1">
                        <h3 className="text-xl font-black uppercase tracking-tighter">Bảng điều khiển BTC</h3>
                        <p className="text-slate-400 text-[10px] font-medium italic">Chào mừng trở lại, {user.email}</p>
                      </div>
                    </div>
                    <div className="flex flex-col gap-4">
                      <input 
                        type="text" 
                        placeholder="Tên giải đấu mới..."
                        className="w-full p-4 bg-white/5 border border-white/10 rounded-xl outline-none focus:border-emerald-500 transition-all font-bold text-sm"
                        value={newTournamentName}
                        onChange={(e) => setNewTournamentName(e.target.value)}
                      />
                      <div className="grid grid-cols-2 gap-4">
                        <button 
                          onClick={createTournament}
                          disabled={!newTournamentName.trim()}
                          className="py-4 bg-emerald-500 text-white rounded-xl font-black uppercase text-[10px] tracking-widest hover:bg-emerald-600 transition-all flex items-center justify-center gap-2 disabled:opacity-30"
                        >
                          Tạo giải mới
                        </button>
                        <button 
                          onClick={logout}
                          className="py-4 bg-white/5 border border-white/10 text-rose-500 rounded-xl font-black uppercase text-[10px] tracking-widest hover:bg-rose-500/10 transition-all"
                        >
                          Đăng xuất
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const OrganizerManagement = () => {
    const [newOrganizerId, setNewOrganizerId] = useState('');
    
    const addOrganizer = async () => {
      if (!selectedTournamentId || !newOrganizerId.trim() || !user) return;
      const updatedIds = Array.from(new Set([...(state.organizerIds || []), newOrganizerId.trim()]));
      try {
        await setDoc(doc(db, 'tournaments', selectedTournamentId), {
          organizerIds: updatedIds
        }, { merge: true });
        setNewOrganizerId('');
        alert('Đã thêm người quản lý thành công!');
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `tournaments/${selectedTournamentId}`);
      }
    };

    return (
      <div className="bg-slate-50 p-6 md:p-8 rounded-3xl border border-slate-200 mt-12">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h3 className="text-sm font-black uppercase tracking-widest text-slate-800 flex items-center gap-2">
              <Users className="w-4 h-4 text-emerald-500" />
              Công tác tổ chức (Cấp quyền quản lý)
            </h3>
            <p className="text-[10px] text-slate-400 mt-1 font-bold uppercase tracking-tight">Thêm tài khoản khác để cùng nhập điểm và quản lý giải</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex gap-2">
            <input 
              type="text" 
              placeholder="Dán UID của người quản lý vào đây..."
              className="flex-1 p-3.5 bg-white border border-slate-200 rounded-xl outline-none focus:border-emerald-500 font-bold text-xs shadow-sm"
              value={newOrganizerId}
              onChange={(e) => setNewOrganizerId(e.target.value)}
            />
            <button 
              onClick={addOrganizer}
              className="px-6 bg-emerald-600 text-white rounded-xl font-black uppercase text-[10px] tracking-widest hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-600/10"
            >
              Cấp quyền
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            {state.organizerIds?.map(id => (
              <div key={id} className="px-3 py-2 bg-white border border-slate-100 rounded-xl flex items-center gap-3 shadow-sm">
                <div className="w-2 h-2 bg-emerald-500 rounded-full"></div>
                <span className="text-[10px] font-black text-slate-600 truncate max-w-[120px] md:max-w-[200px]">{id === user?.uid ? 'BẠN (Chủ giải)' : id}</span>
                {id !== user?.uid && (
                  <button 
                    onClick={async () => {
                      if(confirm('Bạn có chắc muốn thu hồi quyền quản lý của tài khoản này?')) {
                        const updated = state.organizerIds?.filter(oid => oid !== id);
                        await setDoc(doc(db, 'tournaments', selectedTournamentId!), { organizerIds: updated }, { merge: true });
                      }
                    }}
                    className="text-rose-400 hover:text-rose-600 transition-colors p-1"
                  >
                    <Plus className="w-4 h-4 rotate-45" />
                  </button>
                )}
              </div>
            ))}
          </div>
          
          <div className="bg-indigo-50 p-4 rounded-xl flex gap-3">
             <div className="w-5 h-5 bg-indigo-500 rounded-lg flex items-center justify-center shrink-0">
               <Settings className="w-3 h-3 text-white" />
             </div>
             <p className="text-[9px] text-indigo-600 font-bold leading-relaxed uppercase tracking-tight">
               Hướng dẫn: Người được thêm cần cung cấp <span className="text-indigo-800">UID</span>. UID có thể lấy bằng cách nhấn nút <span className="underline">"UID"</span> cạnh nút Đăng xuất ở góc trên bên phải màn hình.
             </p>
          </div>
        </div>
      </div>
    );
  };

  const GroupStandingsTable = ({ groupId, compact = false }: { groupId: string, compact?: boolean, key?: string }) => {
    const rankings = calculateGroupRankings(groupId);
    const group = state.groups.find(g => g.id === groupId);
    if (!group) return null;

    return (
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden flex flex-col">
        <div className={`${compact ? 'bg-slate-800 px-4 py-2' : 'bg-indigo-900 px-6 py-4'} flex justify-between items-center`}>
          <div className="flex items-center gap-2">
            {!compact && <div className="bg-white/20 p-1.5 rounded-lg backdrop-blur-md">
              <Trophy className="w-3.5 h-3.5 text-white" />
            </div>}
            <h3 className={`${compact ? 'text-[10px]' : 'text-sm md:text-base'} font-black text-white uppercase tracking-widest`}>{group.name}</h3>
          </div>
          {compact && <span className="text-[9px] font-black text-white/50 uppercase tracking-widest">Bảng đấu</span>}
        </div>
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left border-collapse min-w-[320px]">
            <thead>
              <tr className="text-[9px] uppercase tracking-wider text-slate-400 bg-slate-50/50">
                <th className="px-4 py-3 font-black">Hạng / Đội</th>
                {!compact && <th className="px-2 py-3 font-black text-center w-10">T</th>}
                {!compact && <th className="px-2 py-3 font-black text-center w-10">B</th>}
                <th className="px-2 py-3 font-black text-center w-10">HS</th>
                <th className="px-4 py-3 font-black text-center w-16">Điểm</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rankings.map((r, idx) => (
                <tr key={r.id} className={`hover:bg-slate-50/50 transition-colors ${idx < 2 ? 'bg-emerald-50/10' : ''}`}>
                  <td className="px-4 py-3 flex items-center gap-3">
                    <span className={`w-5 h-5 flex items-center justify-center rounded-lg text-[9px] font-black shrink-0 ${
                      idx === 0 ? 'bg-amber-400 text-white' : 
                      idx === 1 ? 'bg-slate-300 text-white' : 'bg-slate-50 text-slate-300'
                    }`}>
                      {idx + 1}
                    </span>
                    <span className="font-bold text-slate-700 tracking-tight text-[11px] md:text-xs leading-snug max-w-[200px] line-clamp-2 py-2">{r.name}</span>
                  </td>
                  {!compact && <td className="px-2 py-3 text-center text-slate-600 font-black text-[10px]">{r.wins}</td>}
                  {!compact && <td className="px-2 py-3 text-center text-slate-300 font-black text-[10px]">{r.losses}</td>}
                  <td className="px-2 py-3 text-center text-slate-500 font-black text-[10px]">{r.diff > 0 ? `+${r.diff}` : r.diff}</td>
                  <td className="px-4 py-3 text-center font-black text-emerald-600 text-sm">{r.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const OverviewView = () => {
    const stats = {
      teams: state.teams.length,
      matches: state.matches.length,
      completed: state.matches.filter(m => m.isCompleted).length,
      progress: state.matches.length > 0 ? Math.round((state.matches.filter(m => m.isCompleted).length / state.matches.length) * 100) : 0
    };

    return (
      <div className="space-y-6 md:space-y-12">
        {/* Top Header Section */}
        <div className="relative overflow-hidden rounded-3xl md:rounded-[3rem] bg-indigo-950 p-6 md:p-12 text-white shadow-2xl">
          <div className="absolute top-0 right-0 p-12 opacity-5 scale-150 rotate-12 hidden md:block">
            <Trophy className="w-64 h-64" />
          </div>
          <div className="relative z-10 space-y-6">
            <div className="flex items-center gap-4">
              <span className="px-3 py-1 bg-emerald-500 text-white text-[8px] md:text-[10px] font-black uppercase tracking-[0.2em] rounded-full shadow-lg shadow-emerald-500/20">
                Giai đoạn: {state.stage === 'setup' ? 'Chuẩn bị' : state.stage === 'group' ? 'Vòng bảng' : 'Knockout'}
              </span>
              <span className="text-white/40 font-black text-[8px] md:text-[10px] uppercase tracking-widest">• PB Arena</span>
            </div>
            <h1 className="text-2xl md:text-4xl lg:text-5xl font-extrabold tracking-tight italic leading-[1.1] max-w-3xl text-balance py-2">
              {tournaments.find(t => t.id === selectedTournamentId)?.name || 'Giải Vô Địch Pickleball'}
            </h1>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pt-4">
              <div className="flex flex-col md:flex-row md:items-center gap-6 md:gap-12">
                <div className="space-y-1">
                  <span className="text-[8px] md:text-[10px] font-bold text-white/40 uppercase tracking-widest">Tiến độ giải đấu</span>
                  <div className="flex items-center gap-4">
                    <div className="w-32 md:w-48 h-2 bg-white/10 rounded-full overflow-hidden">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${stats.progress}%` }}
                        className="h-full bg-emerald-500"
                      />
                    </div>
                    <span className="text-xl md:text-2xl font-black">{stats.progress}%</span>
                  </div>
                </div>
                <div className="hidden md:block w-px h-12 bg-white/10" />
                <div className="flex gap-8 md:gap-12">
                  <div className="space-y-1 flex flex-col">
                    <span className="text-[8px] md:text-[10px] font-bold text-white/40 uppercase tracking-widest">Số trận đấu</span>
                    <span className="text-xl md:text-2xl font-black">{stats.completed} / {stats.matches}</span>
                  </div>
                  <div className="hidden md:block w-px h-12 bg-white/10" />
                  <div className="space-y-1 flex flex-col">
                    <span className="text-[8px] md:text-[10px] font-bold text-white/40 uppercase tracking-widest">Đội / VĐV</span>
                    <span className="text-xl md:text-2xl font-black">{state.teams.length}</span>
                  </div>
                </div>
              </div>

              {isOrganizer && (
                <button 
                  onClick={resetTournamentScores}
                  className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/20 px-6 py-3 rounded-2xl flex items-center gap-2 transition-all group"
                >
                  <RefreshCw className="w-4 h-4 group-hover:rotate-180 transition-transform duration-500" />
                  <div className="text-left">
                    <p className="text-[10px] font-black uppercase tracking-widest leading-none">Reset Kết Quả</p>
                    <p className="text-[8px] font-bold text-rose-300/60 uppercase tracking-wider mt-1">Xóa dữ liệu test</p>
                  </div>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Dynamic Content Based on Stage */}
        {state.stage === 'setup' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className={`bg-white p-6 md:p-10 rounded-3xl md:rounded-[2.5rem] border border-slate-200 shadow-sm space-y-6 ${!isOrganizer ? 'opacity-50 pointer-events-none' : ''}`}>
              <h3 className="text-[10px] md:text-sm font-black text-slate-400 uppercase tracking-widest">Đội vừa đăng ký</h3>
              <div className="space-y-4">
                {state.teams.slice(-4).reverse().map((t, i) => (
                  <div key={t.id} className="flex items-center gap-3 md:gap-4 p-3 md:p-4 bg-slate-50 rounded-2xl border border-slate-100">
                    <div className="w-8 h-8 md:w-10 md:h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-[10px] font-black text-slate-400 shadow-sm shrink-0">
                      {state.teams.length - i}
                    </div>
                  <div className="min-w-0">
                    <p className="font-bold text-slate-800 uppercase tracking-tighter truncate text-xs md:text-base">{t.name}</p>
                    <p className="text-[8px] md:text-[9px] text-slate-400 font-bold uppercase tracking-widest">Sẵn sàng</p>
                  </div>
                  </div>
                ))}
                {state.teams.length === 0 && (
                   <p className="text-sm text-slate-400 italic">Chờ đăng ký...</p>
                )}
              </div>
              {isOrganizer && (
                <button 
                  onClick={() => setActiveTab('players')}
                  className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black uppercase text-xs tracking-widest hover:bg-slate-800 transition-all flex items-center justify-center gap-3"
                >
                  <Users className="w-4 h-4" />
                  Quản lý đội
                </button>
              )}
            </div>
            {isOrganizer && (
              <div className="bg-emerald-600 p-8 md:p-10 rounded-3xl md:rounded-[2.5rem] text-white space-y-6 shadow-xl shadow-emerald-500/10">
                <h3 className="text-[10px] md:text-sm font-black text-white/50 uppercase tracking-widest">Cấu hình</h3>
                <div className="space-y-4">
                  <div className="flex justify-between items-center py-3 border-b border-white/10">
                    <span className="text-[10px] font-bold uppercase tracking-widest">Tổng số đội</span>
                    <span className="text-xl md:text-2xl font-black">{state.teams.length}</span>
                  </div>
                  <div className="flex justify-between items-center py-3 border-b border-white/10">
                    <span className="text-[10px] font-bold uppercase tracking-widest">Suất KO</span>
                    <span className="text-xl md:text-2xl font-black">{state.config.knockoutSize}</span>
                  </div>
                </div>
                <div className="pt-4">
                  <button 
                    onClick={() => setActiveTab('setup')}
                    className="w-full py-4 bg-white text-emerald-600 rounded-2xl font-black uppercase text-xs tracking-widest hover:bg-emerald-50 transition-all flex items-center justify-center gap-3"
                  >
                    <Settings className="w-4 h-4" />
                    Cài đặt
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {state.stage === 'group' && (
          <div className="space-y-12">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-black text-slate-400 uppercase tracking-[0.3em] ml-2">Bảng xếp hạng hiện tại</h2>
              <button onClick={() => setActiveTab('groups')} className="text-[10px] font-black text-emerald-600 uppercase tracking-widest hover:underline">Xem Tất cả trận đấu</button>
            </div>
            {isOrganizer ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {state.groups.map(g => (
                  <GroupStandingsTable key={g.id} groupId={g.id} compact />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                 {state.groups.map(g => (
                  <GroupStandingsTable key={g.id} groupId={g.id} compact />
                ))}
              </div>
            )}
          </div>
        )}

        {state.stage === 'knockout' && (
          <div className="space-y-12">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-black text-slate-400 uppercase tracking-[0.3em] ml-2">Sơ đồ phân nhánh Vòng trực tiếp</h2>
              <button onClick={() => setActiveTab('bracket')} className="text-[10px] font-black text-emerald-600 uppercase tracking-widest hover:underline">Cập nhật kết quả</button>
            </div>
            <div className="bg-white p-8 rounded-[3rem] border border-slate-200 shadow-xl overflow-hidden">
               <BracketView />
            </div>
          </div>
        )}
      </div>
    );
  };

  if (!selectedTournamentId) return <TournamentSelection />;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex flex-col overflow-hidden">
      {/* Top Header */}
      <header className="h-16 bg-white border-b border-slate-200 px-4 md:px-8 flex items-center justify-between shadow-sm z-50">
        <div className="flex items-center gap-3 md:gap-6">
          <button 
            onClick={() => setSelectedTournamentId(null)}
            className="w-8 h-8 md:w-10 md:h-10 bg-slate-900 rounded-lg md:rounded-xl flex items-center justify-center text-white hover:bg-emerald-600 transition-all shadow-lg hover:shadow-emerald-200"
          >
            <ChevronLeft className="w-5 h-5 md:w-6 md:h-6" />
          </button>
          <div className="flex items-center gap-2 md:gap-4 overflow-hidden">
            <div className="w-8 h-8 md:w-10 md:h-10 bg-emerald-500 rounded-lg flex items-center justify-center text-white font-black text-sm md:text-xl shadow-lg shadow-emerald-100 shrink-0">
              PB
            </div>
            <div className="min-w-0">
              <h1 className="text-sm md:text-lg font-black text-slate-800 leading-none truncate max-w-[120px] md:max-w-none">
                {state.stage === 'setup' ? 'Chuẩn bị giải' : tournaments.find(t => t.id === selectedTournamentId)?.name || 'Pickleball Pro'}
              </h1>
              <p className="text-[8px] md:text-[10px] text-slate-500 mt-1 uppercase tracking-wider font-bold truncate">
                {selectedTournamentId?.toUpperCase()} • <span className="text-emerald-600 font-black tracking-widest">LIVE</span>
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 md:gap-4">
          {user && isOrganizer && (
            <button 
              onClick={resetTournamentScores}
              className="flex items-center gap-2 px-3 md:px-4 py-2 bg-rose-50 text-rose-600 border border-rose-100 rounded-xl text-[9px] md:text-[10px] font-black uppercase tracking-widest hover:bg-rose-100 transition-all shadow-sm shrink-0"
              title="Reset toàn bộ giải đấu"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Reset Giải</span>
            </button>
          )}
          {!user ? (
            <button 
              onClick={() => setSelectedTournamentId(null)}
              className="flex items-center gap-2 px-3 md:px-6 py-2 bg-slate-900 text-white rounded-xl md:rounded-2xl text-[9px] md:text-[10px] font-black uppercase tracking-widest hover:bg-emerald-600 transition-all shadow-lg"
            >
              <LogIn className="w-3 h-3 md:w-4 md:h-4 text-emerald-400" />
              <span className="hidden xs:inline">Đăng nhập</span>
              <span className="xs:hidden">Login</span>
            </button>
          ) : (
            <div className="flex items-center gap-2 md:gap-4 py-1 pl-1 pr-3 md:pr-4 bg-slate-50 border border-slate-200 rounded-xl md:rounded-2xl shadow-inner">
              <div className="w-8 h-8 md:w-10 md:h-10 rounded-lg md:rounded-xl bg-emerald-500 text-white flex items-center justify-center shadow-lg overflow-hidden border-2 border-white shrink-0">
                {user.photoURL ? <img src={user.photoURL} alt="Avatar" className="w-full h-full object-cover" /> : <Users className="w-4 h-4 md:w-5 md:h-5" />}
              </div>
              <div className="flex flex-col">
                <p className="text-[9px] md:text-[10px] font-black text-slate-800 uppercase tracking-tight leading-none truncate max-w-[60px] xs:max-w-[80px]">{user.displayName || user.email?.split('@')[0]}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <button onClick={logout} className="text-[8px] md:text-[9px] text-rose-500 font-black uppercase tracking-widest hover:underline text-left cursor-pointer">Log out</button>
                  <button 
                    onClick={() => {
                      navigator.clipboard.writeText(user.uid);
                      alert('Đã copy UID của bạn: ' + user.uid);
                    }}
                    className="text-[8px] md:text-[9px] text-indigo-500 font-black uppercase tracking-widest hover:underline"
                  >
                    UID
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
        {/* Navigation Rail - Bottom on Mobile, Left on Desktop */}
        <nav className="fixed bottom-0 left-0 right-0 h-16 md:h-auto md:w-20 bg-white border-t md:border-t-0 md:border-r border-slate-200 flex flex-row md:flex-col py-0 md:py-6 items-center justify-around md:justify-start gap-0 md:gap-4 z-[100] md:relative shadow-[0_-4px_20px_-10px_rgba(0,0,0,0.1)] md:shadow-none">
          {filteredNavItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id as any)}
              className={`flex-1 md:flex-none w-full md:w-12 h-full md:h-12 flex flex-col md:flex-row items-center justify-center gap-1 md:gap-0 rounded-none md:rounded-xl transition-all duration-200 ${
                activeTab === item.id 
                  ? 'text-emerald-600 md:bg-emerald-500 md:text-white md:shadow-lg md:shadow-emerald-100' 
                  : 'text-slate-400 hover:bg-slate-50 hover:text-slate-900'
              }`}
              title={item.label}
            >
              <item.icon className="w-5 h-5 md:w-6 md:h-6" />
              <span className="text-[10px] font-black uppercase tracking-tighter md:hidden">{item.label}</span>
            </button>
          ))}
        </nav>

        {/* Content View */}
        <main className="flex-1 overflow-y-auto bg-slate-50 custom-scrollbar pb-20 md:pb-0">
          <div className="max-w-6xl mx-auto p-4 md:p-8 pb-32">
            <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
              <div>
                <h2 className="text-[10px] md:text-sm font-black text-slate-400 uppercase tracking-[0.2em] mb-1">
                  {state.stage === 'registration' ? 'Giai đoạn đăng ký' : 'Giải đấu đang diễn ra'}
                </h2>
                <h3 className="text-xl md:text-3xl font-black text-slate-900 uppercase">
                  {activeTab === 'players' && 'Quản lý Đội/Cặp'}
                  {activeTab === 'setup' && 'Thiết lập Vòng bảng'}
                  {activeTab === 'groups' && 'Vòng đấu bảng'}
                  {activeTab === 'bracket' && 'Phân nhánh Knockout'}
                  {activeTab === 'dashboard' && 'Tổng quan giải đấu'}
                </h3>
              </div>
              {activeTab === 'players' && (
                <div className="inline-flex bg-white rounded-lg p-1 border border-slate-200 shadow-sm w-fit">
                  <span className="px-4 py-1.5 text-xs font-bold text-emerald-600 bg-emerald-50 rounded-md">
                    {state.teams.length} Đội
                  </span>
                </div>
              )}
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                {activeTab === 'players' && <PlayerManagement />}
                {activeTab === 'setup' && <TournamentSetup />}
                {activeTab === 'groups' && <GroupStageView />}
                {activeTab === 'bracket' && <BracketView />}
                {activeTab === 'dashboard' && <OverviewView />}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>

      {/* Footer Status Bar */}
      <footer className="h-8 bg-emerald-800 text-[10px] text-emerald-100 flex items-center px-6 justify-between z-50">
        <div className="flex items-center gap-6">
          <span className="font-bold opacity-80 uppercase tracking-widest">Pickleball Pro v1.0</span>
          <span className="hidden md:inline">Sân vận động: PB Arena National</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></span>
          <span>Hệ thống đồng bộ trực tuyến</span>
        </div>
      </footer>
    </div>
  );
}

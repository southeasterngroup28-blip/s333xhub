import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { DISPLAY_FONT } from '@/constants/type';
import { pressFeedback, successFeedback, tapFeedback } from '@/lib/haptics';
import { showDateParts, showRelative, type Show } from '@/lib/shows';
import {
  buyTicket,
  fetchMyTickets,
  isPurchaseCancelled,
  liveTickets,
  remaining,
  salesMode,
  ticketForShow,
  ticketsSold,
  type Ticket,
  type TicketStatus,
} from '@/lib/tickets';

// The fan side of ticketing on the Shows tab, kept out of the screen file
// so the row markup there stays about dates: what I hold, what's left,
// and the buy flow. The screen asks `forRow(show)` per row and drops the
// strip above the list.

/** Everything one show row needs to draw its ticket action. */
export type RowTicketing = {
  /** My usable ticket for this show (refunds don't count), if I hold one. */
  ticket: Ticket | null;
  /** Seats left. null = unlimited, or unknown right now — never blocks a buy. */
  left: number | null;
  buying: boolean;
  onBuy: () => void;
  onTicket: () => void;
};

export function useFanTickets({
  shows,
  enabled = true,
  buyerName,
  onError,
}: {
  /** The list on screen — a fresh array every reload, which is what re-reads counts. */
  shows: Show[];
  /** False for the artist: no tickets to hold, and the sold counts are theirs to fetch. */
  enabled?: boolean;
  buyerName?: string | null;
  onError: (message: string) => void;
}) {
  const router = useRouter();
  const [owned, setOwned] = useState<Ticket[]>([]);
  const [sold, setSold] = useState<Record<string, number>>({});
  const [buyingId, setBuyingId] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetchMyTickets()
      .then((mine) => {
        if (!cancelled) setOwned(mine);
      })
      .catch(() => {
        // Signed out or offline — the rows simply show no "Your ticket".
      });
    // Only capped in-app shows need a count; everything else is unlimited.
    const capped = shows.filter((s) => salesMode(s) === 'in_app' && s.capacity != null);
    Promise.all(
      capped.map(async (s) => [s.id, await ticketsSold(s.id).catch(() => null)] as const)
    ).then((pairs) => {
      if (cancelled) return;
      const next: Record<string, number> = {};
      for (const [id, count] of pairs) if (count != null) next[id] = count;
      setSold(next);
    });
    return () => {
      cancelled = true;
    };
  }, [shows, enabled]);

  const buy = useCallback(
    async (show: Show) => {
      if (buyingId) return;
      pressFeedback();
      setBuyingId(show.id);
      try {
        const ticket = await buyTicket(show, buyerName);
        successFeedback();
        setOwned((prev) => [ticket, ...prev.filter((t) => t.id !== ticket.id)]);
        // Typed routes only regenerate while the dev server runs; the cast goes when they do.
        router.push(`/ticket/${ticket.id}` as never);
      } catch (e) {
        // Backing out of the payment sheet isn't an error worth a red line.
        if (!isPurchaseCancelled(e)) {
          onError((e as { message?: string })?.message ?? 'The purchase did not go through.');
        }
      } finally {
        setBuyingId(null);
      }
    },
    [buyingId, buyerName, onError, router]
  );

  const forRow = useCallback(
    (show: Show): RowTicketing => {
      const ticket = ticketForShow(owned, show.id);
      const count = sold[show.id];
      return {
        ticket,
        left: count == null ? null : remaining(show, count),
        buying: buyingId === show.id,
        onBuy: () => buy(show),
        onTicket: () => {
          tapFeedback();
          if (ticket) router.push(`/ticket/${ticket.id}` as never);
        },
      };
    },
    [owned, sold, buyingId, buy, router]
  );

  return {
    /** Tickets for shows that haven't wrapped — what the MY TICKETS strip lists. */
    owned: liveTickets(owned),
    forRow,
    buyingId,
  };
}

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  paid: 'PAID',
  checked_in: 'CHECKED IN',
  refunded: 'REFUNDED',
};

/** Compact "MY TICKETS" block for the top of the Shows list. Renders nothing when empty. */
export function MyTicketsStrip({ tickets }: { tickets: Ticket[] }) {
  const router = useRouter();
  if (tickets.length === 0) return null;

  return (
    <View style={styles.strip}>
      <Text style={styles.label}>MY TICKETS</Text>
      {tickets.map((ticket) => {
        const show = ticket.show;
        const date = show ? showDateParts(show) : null;
        const when = date ? `${date.weekday}, ${date.month} ${date.day} · ${date.time}` : '';
        const title = show?.title || show?.venue || 'Show';
        const sub = show
          ? `${show.title ? show.venue : show.city} · ${when}`
          : 'Show details unavailable';
        const relative = show ? showRelative(show) : null;
        const soon = relative === 'Tonight' || relative === 'Tomorrow';
        return (
          <Pressable
            key={ticket.id}
            style={[styles.card, ticket.status === 'refunded' && styles.cardDim]}
            onPress={() => {
              tapFeedback();
              router.push(`/ticket/${ticket.id}` as never);
            }}>
            <View style={styles.iconBox}>
              <Ionicons name="ticket" size={18} color="#c3cdd6" />
            </View>
            <View style={styles.meta}>
              {soon && relative ? (
                <Text style={styles.eyebrow}>{relative.toUpperCase()}</Text>
              ) : null}
              <Text style={styles.title} numberOfLines={1}>
                {title}
              </Text>
              <Text style={styles.sub} numberOfLines={1}>
                {sub}
              </Text>
            </View>
            <View style={[styles.chip, chipStyle[ticket.status]]}>
              <Text style={[styles.chipText, chipTextStyle[ticket.status]]}>
                {TICKET_STATUS_LABEL[ticket.status]}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={14} color="#55585f" />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { marginBottom: 6 },
  label: {
    color: '#6d7076',
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 1.6,
    marginTop: 10,
    marginBottom: 10,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#14171b',
    borderWidth: 1,
    borderColor: 'rgba(195,205,214,0.35)',
    borderRadius: 16,
    padding: 13,
    marginBottom: 10,
  },
  cardDim: { opacity: 0.5, borderColor: '#23262b' },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#1a1d22',
    alignItems: 'center',
    justifyContent: 'center',
  },
  meta: { flex: 1 },
  eyebrow: { color: '#c3cdd6', fontSize: 9.5, fontWeight: '700', letterSpacing: 1.4, marginBottom: 2 },
  title: { color: '#fff', fontFamily: DISPLAY_FONT, fontSize: 15, lineHeight: 19, letterSpacing: 1 },
  sub: { color: '#8f99a3', fontSize: 11.5, marginTop: 2 },
  chip: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  chipText: { fontSize: 9, fontWeight: '800', letterSpacing: 1 },
});

const chipStyle: Record<TicketStatus, object> = {
  paid: { backgroundColor: 'rgba(195,205,214,0.12)' },
  checked_in: { backgroundColor: 'rgba(126,211,84,0.14)' },
  refunded: { backgroundColor: 'rgba(248,113,113,0.12)' },
};

const chipTextStyle: Record<TicketStatus, object> = {
  paid: { color: '#c3cdd6' },
  checked_in: { color: '#7ed354' },
  refunded: { color: '#f87171' },
};

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, RefreshCw, Search, UserMinus, UserPlus, Users, X } from 'lucide-react';
import {
  cancelFocusMateFriendRequest,
  listFocusMateFriendRequests,
  listFocusMateFriends,
  removeFocusMateFriend,
  respondToFocusMateFriendRequest,
  searchFocusMateUser,
  sendFocusMateFriendRequest,
} from './social-api.js';
import { supabase } from './lib/supabase.js';
import { translate } from './i18n.js';
import { subscribeToFriendPresence } from './presence.js';

function errorText(error) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

export default function SocialPage({ account, language }) {
  const [friends, setFriends] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [searchResult, setSearchResult] = useState(null);
  const [searchComplete, setSearchComplete] = useState(false);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [friendPresence, setFriendPresence] = useState({});
  const refreshRef = useRef(null);
  const t = (key) => translate(language, `social.${key}`);
  const friendIdsKey = friends.map((friend) => friend.friend_id).sort().join(',');

  const refresh = useCallback(async (background = false) => {
    if (background) setRefreshing(true);
    else setLoading(true);
    try {
      const [nextFriends, nextRequests] = await Promise.all([
        listFocusMateFriends(supabase),
        listFocusMateFriendRequests(supabase),
      ]);
      setFriends(nextFriends);
      setRequests(nextRequests);
      setError('');
    } catch (loadError) {
      setError(errorText(loadError));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  refreshRef.current = refresh;

  useEffect(() => {
    void refresh();
    const channel = supabase
      .channel(`friendships:${account.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'friendships',
        filter: `requester_id=eq.${account.id}`,
      }, () => { void refreshRef.current?.(true); })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'friendships',
        filter: `recipient_id=eq.${account.id}`,
      }, () => { void refreshRef.current?.(true); })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [account.id, refresh]);

  useEffect(() => {
    const friendIds = friendIdsKey ? friendIdsKey.split(',') : [];
    let active = true;
    setFriendPresence(Object.fromEntries(friendIds.map((friendId) => [friendId, 'connecting'])));
    const unsubscribe = subscribeToFriendPresence(
      supabase,
      account.id,
      friendIds,
      (states) => { if (active) setFriendPresence(states); },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [account.id, friendIdsKey]);

  const submitSearch = async (event) => {
    event.preventDefault();
    setSearching(true);
    setSearchResult(null);
    setSearchComplete(false);
    setNotice('');
    setError('');
    try {
      const result = await searchFocusMateUser(supabase, search);
      setSearchResult(result);
      setSearchComplete(true);
    } catch (searchError) {
      setError(errorText(searchError));
    } finally {
      setSearching(false);
    }
  };

  const performAction = async (id, action, successMessage) => {
    setBusyId(id);
    setNotice('');
    setError('');
    try {
      await action();
      setNotice(successMessage);
      await refresh(true);
      if (searchResult) {
        setSearchResult(await searchFocusMateUser(supabase, searchResult.username));
      }
    } catch (actionError) {
      setError(errorText(actionError));
    } finally {
      setBusyId('');
    }
  };

  const sendRequest = (username) => performAction(
    `search:${username}`,
    () => sendFocusMateFriendRequest(supabase, username),
    t('requestSent'),
  );

  const respond = (request, accept) => performAction(
    request.request_id,
    () => respondToFocusMateFriendRequest(supabase, request.request_id, accept),
    accept ? t('requestAccepted') : t('requestDeclined'),
  );

  const cancelRequest = (request) => performAction(
    request.request_id,
    () => cancelFocusMateFriendRequest(supabase, request.request_id),
    t('requestCancelled'),
  );

  const removeFriend = (friend) => performAction(
    friend.friend_id,
    () => removeFocusMateFriend(supabase, friend.friend_id),
    t('friendRemoved'),
  );

  const incoming = requests.filter((request) => !request.is_sent_by_me);
  const outgoing = requests.filter((request) => request.is_sent_by_me);

  return (
    <section className="page-content social-page" aria-labelledby="social-title">
      <div className="surface-panel social-search-panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">{t('findPeople')}</span>
            <h2 id="social-title">{t('friends')}</h2>
            <p>{t('searchHelp')}</p>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={() => void refresh(true)}
            disabled={refreshing || loading}
            aria-label={t('refresh')}
            title={t('refresh')}
          >
            <RefreshCw size={17} className={refreshing ? 'social-spin' : ''} />
          </button>
        </div>
        <form className="social-search-form" onSubmit={submitSearch}>
          <label className="social-search-input">
            <span>{t('username')}</span>
            <span className="social-input-wrap">
              <Search size={17} aria-hidden="true" />
              <input
                autoComplete="off"
                maxLength={32}
                autoCapitalize="none"
                spellCheck="false"
                placeholder={t('usernamePlaceholder')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </span>
          </label>
          <button className="primary-button" type="submit" disabled={searching || !search.trim()}>
            <Search size={16} /> {searching ? t('searching') : t('search')}
          </button>
        </form>
        {searching && <p className="social-inline-status" role="status">{t('searching')}</p>}
        {searchComplete && !searchResult && <p className="social-empty" role="status">{t('userNotFound')}</p>}
        {searchResult && (
          <article className="social-user-card">
            <div className="social-avatar" aria-hidden="true">
              {(searchResult.display_name || searchResult.username).slice(0, 1).toUpperCase()}
            </div>
            <div className="social-user-copy">
              <strong>{searchResult.display_name || searchResult.username}</strong>
              <span>@{searchResult.username}</span>
            </div>
            <div className="social-user-action">
              {searchResult.relationship_status === 'friends' && <span className="social-state"><Check size={15} />{t('alreadyFriends')}</span>}
              {searchResult.relationship_status === 'sent' && <span className="social-state">{t('requestPending')}</span>}
              {searchResult.relationship_status === 'received' && <span className="social-state">{t('requestReceived')}</span>}
              {searchResult.relationship_status === 'none' && (
                <button
                  className="outline-button"
                  type="button"
                  disabled={busyId === `search:${searchResult.username}`}
                  onClick={() => void sendRequest(searchResult.username)}
                >
                  <UserPlus size={16} /> {t('addFriend')}
                </button>
              )}
            </div>
          </article>
        )}
      </div>

      {account.presenceState !== 'online' && (
        <div className={`social-message${account.presenceState === 'unavailable' ? ' is-error' : ''}`} role="status">
          {t(account.presenceState === 'unavailable' ? 'presenceUnavailable' : 'presenceConnecting')}
        </div>
      )}
      {error && <div className="social-message is-error" role="alert">{error}</div>}
      {notice && <div className="social-message" role="status">{notice}</div>}

      <div className="social-columns">
        <section className="surface-panel social-list-panel" aria-labelledby="friends-heading">
          <div className="social-list-heading">
            <div><Users size={18} aria-hidden="true" /><h2 id="friends-heading">{t('myFriends')}</h2></div>
            <span className="social-count" aria-label={`${t('myFriends')}: ${friends.length}`}>{friends.length}</span>
          </div>
          {loading
            ? <p className="social-inline-status" role="status">{t('loading')}</p>
            : friends.length === 0
              ? <div className="social-empty"><strong>{t('noFriends')}</strong><span>{t('noFriendsHelp')}</span></div>
              : <ul className="social-list">
                {friends.map((friend) => (
                  <li className="social-user-card" key={friend.friend_id}>
                    <div className="social-avatar" aria-hidden="true">
                      {(friend.display_name || friend.username).slice(0, 1).toUpperCase()}
                    </div>
                    <div className="social-user-copy">
                      <strong>{friend.display_name || friend.username}</strong>
                      <span>@{friend.username}</span>
                      <span className={`social-presence is-${friendPresence[friend.friend_id] || 'connecting'}`}>
                        <i aria-hidden="true" />
                        {t(`presence${(friendPresence[friend.friend_id] || 'connecting')[0].toUpperCase()}${(friendPresence[friend.friend_id] || 'connecting').slice(1)}`)}
                      </span>
                    </div>
                    <button
                      className="icon-button social-remove-button"
                      type="button"
                      disabled={busyId === friend.friend_id}
                      onClick={() => void removeFriend(friend)}
                      aria-label={`${t('removeFriend')} @${friend.username}`}
                      title={t('removeFriend')}
                    >
                      <UserMinus size={17} />
                    </button>
                  </li>
                ))}
              </ul>}
        </section>

        <section className="surface-panel social-list-panel" aria-labelledby="requests-heading">
          <div className="social-list-heading">
            <div><UserPlus size={18} aria-hidden="true" /><h2 id="requests-heading">{t('requests')}</h2></div>
            <span className="social-count" aria-label={`${t('requests')}: ${incoming.length}`}>{incoming.length}</span>
          </div>
          {loading
            ? <p className="social-inline-status" role="status">{t('loading')}</p>
            : requests.length === 0
              ? <div className="social-empty"><strong>{t('noRequests')}</strong><span>{t('noRequestsHelp')}</span></div>
              : <ul className="social-list">
                {incoming.map((request) => (
                  <li className="social-user-card social-request-card" key={request.request_id}>
                    <div className="social-avatar" aria-hidden="true">
                      {(request.display_name || request.username).slice(0, 1).toUpperCase()}
                    </div>
                    <div className="social-user-copy">
                      <strong>{request.display_name || request.username}</strong>
                      <span>@{request.username} · {t('wantsToConnect')}</span>
                    </div>
                    <div className="social-actions">
                      <button
                        className="icon-button social-accept-button"
                        type="button"
                        disabled={busyId === request.request_id}
                        onClick={() => void respond(request, true)}
                        aria-label={`${t('accept')} @${request.username}`}
                        title={t('accept')}
                      ><Check size={17} /></button>
                      <button
                        className="icon-button social-decline-button"
                        type="button"
                        disabled={busyId === request.request_id}
                        onClick={() => void respond(request, false)}
                        aria-label={`${t('decline')} @${request.username}`}
                        title={t('decline')}
                      ><X size={17} /></button>
                    </div>
                  </li>
                ))}
                {outgoing.map((request) => (
                  <li className="social-user-card social-request-card" key={request.request_id}>
                    <div className="social-avatar" aria-hidden="true">
                      {(request.display_name || request.username).slice(0, 1).toUpperCase()}
                    </div>
                    <div className="social-user-copy">
                      <strong>{request.display_name || request.username}</strong>
                      <span>@{request.username} · {t('pending')}</span>
                    </div>
                    <button
                      className="outline-button social-cancel-button"
                      type="button"
                      disabled={busyId === request.request_id}
                      onClick={() => void cancelRequest(request)}
                    >{t('cancelRequest')}</button>
                  </li>
                ))}
              </ul>}
        </section>
      </div>
    </section>
  );
}

import { useEffect, useRef, useState } from 'react';
import { RefreshCw, Trophy } from 'lucide-react';
import { translate } from './i18n.js';
import { supabase } from './lib/supabase.js';
import {
  getFocusMateLeaderboard,
  leaderboardErrorTranslationKey,
  setFocusMateLeaderboardVisibility,
} from './leaderboard-api.js';

const pageSize = 20;

function focusMinutes(seconds, language) {
  return Math.floor(Number(seconds) / 60).toLocaleString(language);
}

export default function LeaderboardPage({ account, language }) {
  const [period, setPeriod] = useState('weekly');
  const [scope, setScope] = useState('global');
  const [online, setOnline] = useState(navigator.onLine);
  const [data, setData] = useState(null);
  const [entries, setEntries] = useState([]);
  const [visibility, setVisibility] = useState('private');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [savingVisibility, setSavingVisibility] = useState(false);
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [refreshCount, setRefreshCount] = useState(0);
  const requestGeneration = useRef(0);
  const t = (key) => translate(language, `leaderboard.${key}`);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    const generation = ++requestGeneration.current;
    let active = true;
    setLoading(true);
    setError('');
    setData(null);
    setEntries([]);

    if (!online) {
      setError('leaderboard.error.offline');
      setLoading(false);
      return () => { active = false; };
    }

    getFocusMateLeaderboard(supabase, { period, scope, limit: pageSize })
      .then((result) => {
        if (!active || generation !== requestGeneration.current) return;
        setData(result);
        setEntries(result.entries);
        setVisibility(result.progress.visibility);
      })
      .catch((loadError) => {
        if (active && generation === requestGeneration.current) {
          setError(leaderboardErrorTranslationKey(loadError));
        }
      })
      .finally(() => {
        if (active && generation === requestGeneration.current) setLoading(false);
      });

    return () => { active = false; };
  }, [account.id, online, period, scope, refreshCount]);

  const changeVisibility = async (event) => {
    const nextVisibility = event.target.value;
    setSavingVisibility(true);
    setSaveError('');
    try {
      setVisibility(await setFocusMateLeaderboardVisibility(supabase, nextVisibility));
      setRefreshCount((value) => value + 1);
    } catch (saveErrorValue) {
      setSaveError(leaderboardErrorTranslationKey(saveErrorValue));
    } finally {
      setSavingVisibility(false);
    }
  };

  const loadMore = async () => {
    if (!data?.has_more || loadingMore || !online) return;
    const generation = requestGeneration.current;
    setLoadingMore(true);
    setError('');
    try {
      const result = await getFocusMateLeaderboard(supabase, {
        period,
        scope,
        limit: pageSize,
        offset: entries.length,
      });
      if (generation !== requestGeneration.current) return;
      setData(result);
      setEntries((current) => [...current, ...result.entries]);
    } catch (loadError) {
      if (generation === requestGeneration.current) {
        setError(leaderboardErrorTranslationKey(loadError));
      }
    } finally {
      if (generation === requestGeneration.current) setLoadingMore(false);
    }
  };

  return (
    <section className="page-content leaderboard-page" aria-labelledby="leaderboard-title">
      <section className="surface-panel leaderboard-panel">
        <div className="section-heading leaderboard-heading">
          <div>
            <span className="eyebrow">{t('eyebrow')}</span>
            <h2 id="leaderboard-title">{t('title')}</h2>
            <p>{t('description')}</p>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={() => setRefreshCount((value) => value + 1)}
            disabled={loading || !online}
            aria-label={t('refresh')}
            title={t('refresh')}
          >
            <RefreshCw size={17} className={loading ? 'social-spin' : ''} />
          </button>
        </div>

        <div className="leaderboard-filters">
          <div className="leaderboard-toggle" role="group" aria-label={t('period')}>
            {['weekly', 'all_time'].map((value) => (
              <button
                className={period === value ? 'active' : ''}
                key={value}
                type="button"
                aria-pressed={period === value}
                onClick={() => setPeriod(value)}
              >
                {t(value)}
              </button>
            ))}
          </div>
          <div className="leaderboard-toggle" role="group" aria-label={t('scope')}>
            {['global', 'friends'].map((value) => (
              <button
                className={scope === value ? 'active' : ''}
                key={value}
                type="button"
                aria-pressed={scope === value}
                onClick={() => setScope(value)}
              >
                {t(value)}
              </button>
            ))}
          </div>
        </div>

        {data && (
          <section className="leaderboard-progress" aria-label={t('yourProgress')}>
            <h3>{t('yourProgress')}</h3>
            <div className="leaderboard-progress-grid">
              <div>
                <span>{t('allTimeTotal')}</span>
                <strong>{focusMinutes(data.progress.all_time_seconds, language)}</strong>
                <small>{t('minutes')}</small>
              </div>
              <div>
                <span>{t('weekTotal')}</span>
                <strong>{focusMinutes(data.progress.weekly_seconds, language)}</strong>
                <small>{t('minutes')}</small>
              </div>
              <div>
                <span>{t('weekRank')}</span>
                <strong>{!data.progress.listed || data.progress.weekly_rank == null
                  ? t('unranked')
                  : `#${Number(data.progress.weekly_rank).toLocaleString(language)}`}</strong>
                <small>{scope === 'friends' ? t('friends') : t('global')}</small>
              </div>
            </div>
          </section>
        )}

        <div className="leaderboard-privacy">
          <div>
            <strong>{t('privacyTitle')}</strong>
            <p>{t('privacyHelp')}</p>
          </div>
          <label>
            <span className="visually-hidden">{t('privacyTitle')}</span>
            <select
              value={visibility}
              disabled={savingVisibility || loading || !online}
              onChange={(event) => void changeVisibility(event)}
            >
              {['private', 'friends', 'public'].map((value) => (
                <option key={value} value={value}>{t(`visibility.${value}`)}</option>
              ))}
            </select>
          </label>
        </div>
        {saveError && <p className="leaderboard-error" role="alert">{t(saveError)}</p>}

        <div className="leaderboard-list-heading">
          <h3>{t('rankings')}</h3>
          {data && <span>{t(period)} · {scope === 'friends' ? t('friends') : t('global')}</span>}
        </div>

        {loading && <p className="leaderboard-status" role="status">{t('loading')}</p>}
        {!loading && error && (
          <div className="leaderboard-status leaderboard-error" role="alert">
            <p>{t(error)}</p>
            <button
              className="outline-button"
              type="button"
              disabled={!online}
              onClick={() => setRefreshCount((value) => value + 1)}
            >
              {t('retry')}
            </button>
          </div>
        )}
        {!loading && !error && entries.length === 0 && (
          <div className="leaderboard-status">
            <Trophy size={22} aria-hidden="true" />
            <strong>{t('emptyTitle')}</strong>
            <p>{t(scope === 'friends' ? 'emptyFriends' : 'emptyGlobal')}</p>
          </div>
        )}
        {!loading && entries.length > 0 && (
          <ol className="leaderboard-list">
            {entries.map((entry) => (
              <li
                className={`leaderboard-entry ${entry.username === account.username ? 'leaderboard-entry-self' : ''}`}
                key={`${entry.rank}:${entry.username}`}
              >
                <span className="leaderboard-rank">#{Number(entry.rank).toLocaleString(language)}</span>
                <span className="leaderboard-person">
                  <strong>{entry.display_name || entry.username}</strong>
                  <small>@{entry.username}</small>
                </span>
                <strong className="leaderboard-score">
                  {focusMinutes(entry.focus_seconds, language)} <small>{t('minutes')}</small>
                </strong>
              </li>
            ))}
          </ol>
        )}
        {!loading && error && entries.length > 0 && <p className="leaderboard-error" role="alert">{t(error)}</p>}
        {data?.has_more && !loading && !error && (
          <button
            className="outline-button leaderboard-more"
            type="button"
            onClick={() => void loadMore()}
            disabled={loadingMore || !online}
          >
            {loadingMore ? t('loadingMore') : t('loadMore')}
          </button>
        )}
        <p className="leaderboard-footnote">{t('verifiedSource')}</p>
      </section>
    </section>
  );
}

/**
 * Lampa plugin: default audio track language.
 *
 * Adds "Settings -> Player -> Audio track language" and, when a video starts,
 * switches to the first embedded audio track in the chosen language.
 *
 * Written in ES5: older Samsung Tizen / LG webOS engines don't support ES6+.
 */
(function () {
    'use strict';

    var VERSION = '1.0.0';
    var PARAM = 'audio_select_lang';
    var OFF = 'off';

    /**
     * codes - ISO 639-1/639-2 codes matched exactly against track language fields.
     * words - prefixes matched against tokens of the track name/label.
     */
    var LANGUAGES = {
        rus: { codes: ['ru', 'rus'], words: ['russian', 'русск', 'рус'] },
        eng: { codes: ['en', 'eng'], words: ['english', 'англ'] },
        ukr: { codes: ['uk', 'ukr'], words: ['ukrainian', 'украин', 'українськ', 'укр'] }
    };

    var SCORE_LANGUAGE_FIELD = 2;
    var SCORE_NAME = 1;

    // Url of the stream we already handled, so repeated 'tracks' events don't override a manual switch
    var handledUrl = null;

    function log() {
        try {
            var args = Array.prototype.slice.call(arguments);
            args.unshift('AudioSelect');
            console.log.apply(console, args);
        } catch (e) {}
    }

    function normalizeCode(value) {
        return String(value || '').toLowerCase().split(/[-_]/)[0].trim();
    }

    function tokenize(value) {
        return String(value || '').toLowerCase().split(/[\s.,;:\/\\()\[\]|·•\-_+]+/).filter(Boolean);
    }

    function languageFields(track) {
        var fields = [track.language, track.lang];
        if (track.extra && typeof track.extra === 'object') fields.push(track.extra.language, track.extra.track_lang);
        return fields;
    }

    function nameFields(track) {
        return [track.name, track.label, track.title];
    }

    /**
     * How well a track matches the language: 0 - no match.
     */
    function score(track, lang) {
        var rule = LANGUAGES[lang];
        var result = 0;

        languageFields(track).forEach(function (value) {
            if (rule.codes.indexOf(normalizeCode(value)) >= 0) result = Math.max(result, SCORE_LANGUAGE_FIELD);
        });

        nameFields(track).forEach(function (value) {
            tokenize(value).forEach(function (token) {
                var hit = rule.codes.indexOf(token) >= 0 || rule.words.some(function (word) {
                    return token.indexOf(word) === 0;
                });
                if (hit) result = Math.max(result, SCORE_NAME);
            });
        });

        return result;
    }

    /**
     * Index of the best matching track, -1 if none. Ties go to the earlier track.
     */
    function pickTrack(tracks, lang) {
        var best = -1;
        var bestScore = 0;

        for (var i = 0; i < tracks.length; i++) {
            var s = score(tracks[i], lang);
            if (s > bestScore) {
                best = i;
                bestScore = s;
            }
        }

        return best;
    }

    function isActive(track) {
        return track.selected === true || track.enabled === true;
    }

    function trackTitle(track) {
        var parts = [];
        nameFields(track).concat(languageFields(track)).forEach(function (value) {
            if (value && typeof value !== 'object' && parts.indexOf(String(value)) < 0) parts.push(String(value));
        });
        return parts.join(' · ');
    }

    /**
     * Switch to tracks[index]. Works with Lampa's Tizen/HLS wrappers (setter acts on enabled = true)
     * and with native HTML5 AudioTrack objects (several can be enabled, so the rest are disabled).
     */
    function enable(tracks, index) {
        tracks.forEach(function (track, i) {
            if (i !== index) track.selected = false;
        });

        tracks[index].enabled = true;
        tracks[index].selected = true;

        tracks.forEach(function (track, i) {
            if (i === index) return;
            try {
                track.enabled = false;
            } catch (e) {}
        });
    }

    function playData() {
        try {
            return Lampa.Player.playdata() || {};
        } catch (e) {
            return {};
        }
    }

    function onTracks(event) {
        var lang = Lampa.Storage.field(PARAM);
        if (!lang || lang === OFF || !LANGUAGES[lang]) return;

        var tracks = event && event.tracks;
        if (!tracks || tracks.length < 2) return;

        var data = playData();

        // Online sources switch voiceovers themselves; transcoded torrents choose audio via ?audio= on TorrServer
        if (data.voiceovers || String(data.url || '').indexOf('/gst/') >= 0) return;

        var url = data.url || '';
        if (url && url === handledUrl) return;
        handledUrl = url;

        var index = pickTrack(tracks, lang);
        if (index < 0) {
            log('no track for', lang);
            return;
        }

        if (isActive(tracks[index])) {
            log('already playing', index);
            return;
        }

        try {
            enable(tracks, index);
            log('switched to track', index, trackTitle(tracks[index]));
            Lampa.Noty.show(Lampa.Lang.translate('audio_select_switched') + ': ' + (trackTitle(tracks[index]) || '#' + (index + 1)));
        } catch (e) {
            log('switch failed', e && e.message);
        }
    }

    function addTranslations() {
        Lampa.Lang.add({
            audio_select_param: {
                ru: 'Язык аудиодорожки',
                en: 'Audio track language',
                uk: 'Мова аудіодоріжки'
            },
            audio_select_param_descr: {
                ru: 'Какую дорожку включать при запуске видео, если в файле их несколько',
                en: 'Which track to play on start when the file has several',
                uk: 'Яку доріжку вмикати під час запуску відео, якщо у файлі їх кілька'
            },
            audio_select_off: {
                ru: 'Не менять',
                en: 'Don\'t change',
                uk: 'Не змінювати'
            },
            audio_select_switched: {
                ru: 'Аудиодорожка',
                en: 'Audio track',
                uk: 'Аудіодоріжка'
            }
        });
    }

    function addSettings() {
        var values = {};
        values[OFF] = Lampa.Lang.translate('audio_select_off');
        values.rus = 'Русский';
        values.eng = 'English';
        values.ukr = 'Українська';

        Lampa.SettingsApi.addParam({
            component: 'player',
            param: {
                name: PARAM,
                type: 'select',
                values: values,
                default: OFF
            },
            field: {
                name: Lampa.Lang.translate('audio_select_param'),
                description: Lampa.Lang.translate('audio_select_param_descr')
            }
        });
    }

    function start() {
        if (window.audio_select_plugin) return;
        window.audio_select_plugin = { version: VERSION, pickTrack: pickTrack };

        addTranslations();
        addSettings();

        Lampa.PlayerVideo.listener.follow('tracks', onTracks);
        Lampa.Player.listener.follow('destroy', function () {
            handledUrl = null;
        });

        log('loaded', VERSION);
    }

    if (window.appready) start();
    else Lampa.Listener.follow('app', function (e) {
        if (e.type === 'ready') start();
    });
})();

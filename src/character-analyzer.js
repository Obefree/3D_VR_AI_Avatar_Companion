(() => {
  const clamp01 = (value) => Math.max(0, Math.min(1, Number(value)));

  function clean(value) {
    return String(value || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
  }

  function dialogueLines(script) {
    const fromCore = window.__novaScenarioCore?.splitScenario?.(script)?.flatMap((beat) => beat.dialogue);
    if (Array.isArray(fromCore) && fromCore.length) return fromCore;
    const result = [];
    const regex = /[«“"]([^»”"]{1,700})[»”"]/g;
    let match;
    while ((match = regex.exec(String(script || '')))) result.push(match[1].trim());
    return result;
  }

  function count(text, regex) {
    const matches = String(text || '').match(regex);
    return matches ? matches.length : 0;
  }

  function scoreTraits(script) {
    const lower = String(script || '').toLowerCase();
    const warm = count(lower, /улыб|мягк|тепл|добр|забот|приветл|friendly|warm|kind|gentl|smil/g);
    const cold = count(lower, /холодн|отстран|сухо|cold|distant|detached/g);
    const confident = count(lower, /уверен|спокойн|решител|смело|confident|calm|decisive|firm/g);
    const anxious = count(lower, /нерв|трев|боится|страх|неувер|anxious|nervous|afraid|hesitat/g);
    const playful = count(lower, /шут|игрив|подмиг|сме[её]т|playful|jok|teas|wink|laugh/g);
    const restrained = count(lower, /сдержан|тихо|осторож|пауз|restrained|quiet|careful|measured/g);
    const initiative = count(lower, /сама|первой|подходит|начинает|бер[её]т|предлагает|initiates|approaches|offers|takes/g);
    const reactive = count(lower, /отвечает|реагирует|жд[её]т|после того как|responds|reacts|waits/g);

    return {
      warmth: clamp01(0.58 + warm * 0.08 - cold * 0.12),
      confidence: clamp01(0.58 + confident * 0.08 - anxious * 0.09),
      initiative: clamp01(0.52 + initiative * 0.07 - reactive * 0.04),
      curiosity: clamp01(0.58 + count(lower, /интерес|изуч|рассматри|спрашивает|curious|examines|asks/g) * 0.07),
      playfulness: clamp01(0.2 + playful * 0.12),
      restraint: clamp01(0.55 + restrained * 0.07 + cold * 0.04 - playful * 0.05),
    };
  }

  function inferRole(script) {
    const lower = String(script || '').toLowerCase();
    if (/врач|doctor|medic/.test(lower)) return 'doctor / medical scene character';
    if (/учител|teacher|mentor|инструктор|instructor/.test(lower)) return 'teacher / guide';
    if (/продав|seller|shop assistant|консультант/.test(lower)) return 'consultant / service character';
    if (/актрис|actor|actress|съ[её]м|scene/.test(lower)) return 'scene character / AI actress';
    if (/помощни|assistant|companion|напарник/.test(lower)) return 'AI companion';
    return 'scene character and spatial companion';
  }

  function inferRelationship(script) {
    const lower = String(script || '').toLowerCase();
    if (/незнаком|stranger|впервые видит|first time/.test(lower)) return 'stranger / first encounter';
    if (/друг|подруг|friend/.test(lower)) return 'friendly acquaintance';
    if (/партн[её]р|partner|напарник/.test(lower)) return 'partner';
    if (/клиент|customer|patient|пациент/.test(lower)) return 'professional relationship';
    if (/зрител|геро|пользовател|viewer|user|hero/.test(lower)) return 'direct scene partner: viewer';
    return 'unspecified scene partner';
  }

  function inferGoals(script) {
    const text = clean(script);
    const goals = [];
    const explicit = [
      /(?:хочет|пытается|стремится|должна|её цель|ее цель)\s+([^.!?]{3,140})/gi,
      /(?:wants to|tries to|aims to|must|her goal is to)\s+([^.!?]{3,140})/gi,
    ];
    for (const regex of explicit) {
      let match;
      while ((match = regex.exec(text))) {
        const value = clean(match[1]).replace(/[«»“”"]/g, '');
        if (value && !goals.includes(value)) goals.push(value);
      }
    }
    const lower = text.toLowerCase();
    if (/объясн|показыва|инструкт|explain|show|guide/.test(lower)) goals.push('Help the scene partner understand what to do or notice.');
    if (/успокаива|поддерж|comfort|reassur|support/.test(lower)) goals.push('Reassure and support the scene partner.');
    if (/убед|persuad|convinc/.test(lower)) goals.push('Persuade the scene partner.');
    if (/узна|выясн|спрашива|find out|ask/.test(lower)) goals.push('Learn information from the scene partner.');
    if (/привет|знаком|greet|meet/.test(lower)) goals.push('Establish contact with the scene partner.');
    return [...new Set(goals)].slice(0, 6);
  }

  function inferMovement(script) {
    const lower = String(script || '').toLowerCase();
    const vocabulary = [
      ['look', /смотр|гляд|замеч|look|watch|notice/g],
      ['turn', /поворач|разворач|turn/g],
      ['approach', /подход|подойд|приближ|ближе|approach|closer/g],
      ['walk', /ид[её]т|шага|walk|step/g],
      ['wave', /машет|помах|wave/g],
      ['point', /показыва|указывает|point/g],
      ['interact', /бер[её]т|трога|нажима|открыва|закрыва|takes|touch|press|open|close/g],
      ['pause', /пауз|замира|жд[её]т|pause|wait/g],
      ['gesture', /жест|рук|gesture|hand/g],
    ];
    return vocabulary
      .map(([name, regex]) => ({ name, count: count(lower, regex) }))
      .filter((item) => item.count > 0)
      .sort((a, b) => b.count - a.count);
  }

  function inferSpeech(script) {
    const lines = dialogueLines(script);
    const joined = lines.join(' ');
    const words = joined ? joined.split(/\s+/).filter(Boolean) : [];
    const questionRate = lines.length ? lines.filter((line) => /\?/.test(line)).length / lines.length : 0;
    const exclamationRate = lines.length ? lines.filter((line) => /!/.test(line)).length / lines.length : 0;
    const avgWords = lines.length ? words.length / lines.length : 0;
    let style = 'natural, concise, emotionally grounded';
    if (questionRate > 0.45) style = 'inquisitive, conversational, attentive';
    else if (exclamationRate > 0.35) style = 'expressive, energetic, direct';
    else if (avgWords > 20) style = 'thoughtful, explanatory, conversational';
    else if (lines.length) style = 'concise, direct, conversational';
    return {
      style,
      tempo: /быстро|тороп|quick|fast|urgent/i.test(script) ? 'quick' : /медленно|тихо|slow|quiet/i.test(script) ? 'measured' : 'calm conversational',
      verbosity: avgWords > 20 ? 'medium' : 'short unless the scene requires more',
      examples: lines.slice(0, 8),
      stats: { lines: lines.length, averageWords: Number(avgWords.toFixed(1)), questionRate: Number(questionRate.toFixed(2)) },
    };
  }

  function inferBehavior(script, traits, movement) {
    const rules = [];
    const movementNames = new Set(movement.map((item) => item.name));
    if (movementNames.has('look')) rules.push('Use gaze to establish attention before major actions or dialogue.');
    if (movementNames.has('approach')) rules.push('Approach the scene partner when the scene calls for direct engagement.');
    if (movementNames.has('point')) rules.push('Use clear pointing gestures when directing attention to an object.');
    if (movementNames.has('pause')) rules.push('Allow pauses to land instead of filling every moment with motion.');
    if (traits.warmth > 0.68) rules.push('Favor open, welcoming body language unless the emotional beat changes.');
    if (traits.restraint > 0.68) rules.push('Keep gestures controlled and avoid constant movement.');
    if (traits.initiative > 0.68) rules.push('Take initiative when the script leaves a small transition implicit.');
    rules.push('Preserve continuity of attention, relationship and emotional state across consecutive beats.');
    return rules;
  }

  function localAnalyze(script) {
    const text = clean(script);
    const traits = scoreTraits(text);
    const movementVocabulary = inferMovement(text);
    const speech = inferSpeech(text);
    const goals = inferGoals(text);
    const relationship = inferRelationship(text);
    const role = inferRole(text);
    const emotionalArc = window.__novaScenarioCore?.splitScenario?.(text).map((beat) => ({ id: beat.id, emotion: beat.emotion, text: beat.raw })) || [];
    const behavior = inferBehavior(text, traits, movementVocabulary);

    return {
      source: 'local',
      role,
      archetype: traits.warmth > 0.7 && traits.initiative > 0.6 ? 'warm proactive scene partner' : traits.restraint > 0.7 ? 'controlled observant scene partner' : 'attentive cinematic scene partner',
      relationship,
      traits,
      goals: goals.length ? goals : ['Perform the current scene coherently while maintaining contact with the scene partner.'],
      behavior,
      speech,
      movement: {
        vocabulary: movementVocabulary,
        gestureIntensity: clamp01(0.42 + movementVocabulary.filter((item) => ['wave', 'point', 'gesture'].includes(item.name)).reduce((sum, item) => sum + item.count, 0) * 0.07),
        gazeEngagement: movementVocabulary.some((item) => item.name === 'look') ? 0.86 : 0.72,
        personalDistanceMeters: /очень близко|вплотную|very close|intimate/i.test(text) ? 0.9 : /держит дистанц|keeps distance|отдал/i.test(text) ? 2.0 : 1.35,
      },
      emotionalArc,
      dialogueExamples: speech.examples,
      inferredFrom: text,
    };
  }

  function extractJson(text) {
    const value = String(text || '').trim();
    const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] || value;
    const start = fenced.indexOf('{');
    const end = fenced.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try { return JSON.parse(fenced.slice(start, end + 1)); } catch { return null; }
  }

  function mergeAi(local, ai) {
    if (!ai || typeof ai !== 'object') return local;
    return {
      ...local,
      source: 'ai+local',
      role: clean(ai.role) || local.role,
      archetype: clean(ai.archetype) || local.archetype,
      relationship: clean(ai.relationship) || local.relationship,
      traits: { ...local.traits, ...(ai.traits && typeof ai.traits === 'object' ? Object.fromEntries(Object.entries(ai.traits).map(([k, v]) => [k, clamp01(v)])) : {}) },
      goals: Array.isArray(ai.goals) && ai.goals.length ? ai.goals.map(clean).filter(Boolean).slice(0, 6) : local.goals,
      behavior: Array.isArray(ai.behavior) && ai.behavior.length ? ai.behavior.map(clean).filter(Boolean).slice(0, 8) : local.behavior,
      speech: { ...local.speech, ...(ai.speech && typeof ai.speech === 'object' ? ai.speech : {}) },
    };
  }

  async function aiAnalyze(script, local) {
    const endpoint = window.__NOVA_AI_ENDPOINT;
    if (!endpoint) return local;
    const prompt = [
      'CHARACTER ANALYSIS MODE. Analyze ONLY the character represented by Nova in the scenario below.',
      'Infer characterization from behavior, dialogue and stage directions. Do not rewrite the scene.',
      'Return ONLY JSON as your text response, with this shape:',
      '{"role":"...","archetype":"...","relationship":"...","traits":{"warmth":0-1,"confidence":0-1,"initiative":0-1,"curiosity":0-1,"playfulness":0-1,"restraint":0-1},"goals":["..."],"behavior":["..."],"speech":{"style":"...","tempo":"...","verbosity":"..."}}',
      `SCENARIO:\n${script}`,
    ].join('\n\n');

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({ message: prompt, history: [], scene: window.__novaScene?.getSceneContext?.() || {}, toolResults: [], phase: 'initial', locale: navigator.language || 'en-US' }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false) throw new Error(data?.error || `AI HTTP ${response.status}`);
    const parsed = extractJson(data?.text);
    return parsed ? mergeAi(local, parsed) : local;
  }

  async function analyze(script, options = {}) {
    const local = localAnalyze(script);
    if (options.ai === false) return local;
    try { return await aiAnalyze(script, local); }
    catch (error) {
      console.warn('AI character analysis unavailable; local analysis retained:', error);
      return local;
    }
  }

  function profilePatch(analysis) {
    const current = window.__novaCharacterProfile?.get?.() || {};
    return {
      role: analysis.role || current.role,
      archetype: analysis.archetype || current.archetype,
      character: { ...(analysis.traits || {}) },
      goals: analysis.goals?.length ? analysis.goals : current.goals,
      behavior: analysis.behavior?.length ? analysis.behavior : current.behavior,
      speech: {
        style: analysis.speech?.style || current.speech?.style,
        tempo: analysis.speech?.tempo || current.speech?.tempo,
        verbosity: analysis.speech?.verbosity || current.speech?.verbosity,
      },
      movement: {
        gestureIntensity: analysis.movement?.gestureIntensity ?? current.movement?.gestureIntensity,
        gazeEngagement: analysis.movement?.gazeEngagement ?? current.movement?.gazeEngagement,
        personalDistanceMeters: analysis.movement?.personalDistanceMeters ?? current.movement?.personalDistanceMeters,
      },
      analysis: {
        relationship: analysis.relationship,
        movementVocabulary: analysis.movement?.vocabulary || [],
        emotionalArc: analysis.emotionalArc || [],
        dialogueExamples: analysis.dialogueExamples || [],
        source: analysis.source,
      },
    };
  }

  function apply(analysis) {
    if (!window.__novaCharacterProfile?.update) throw new Error('Character Profile is not ready');
    return window.__novaCharacterProfile.update(profilePatch(analysis));
  }

  function summary(analysis) {
    const moves = analysis.movement?.vocabulary?.map((item) => `${item.name}${item.count > 1 ? `×${item.count}` : ''}`).join(', ') || '—';
    const goals = analysis.goals?.join(' · ') || '—';
    const examples = analysis.dialogueExamples?.slice(0, 3).map((line) => `“${line}”`).join(' · ') || '—';
    return `Role: ${analysis.role}\nArchetype: ${analysis.archetype}\nRelationship: ${analysis.relationship}\nGoals: ${goals}\nMovement: ${moves}\nSpeech: ${analysis.speech?.style || '—'}\nExamples: ${examples}`;
  }

  window.__novaCharacterAnalyzer = { analyze, apply, localAnalyze, profilePatch, summary };
})();

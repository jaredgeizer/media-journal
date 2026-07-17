// Storage abstraction: talks to Supabase when configured, otherwise falls
// back to a localStorage-backed "Demo Mode" so the app is usable (on a
// single device) with zero setup.

const DEMO_USER_ID = 'demo-user';
const DEMO_KEY = 'mediaJournal.demo.items';
const DEMO_GOALS_KEY = 'mediaJournal.demo.goals';

function isConfigured(cfg) {
  return (
    cfg &&
    cfg.supabaseUrl &&
    cfg.supabaseAnonKey &&
    !cfg.supabaseUrl.startsWith('YOUR_') &&
    !cfg.supabaseAnonKey.startsWith('YOUR_')
  );
}

function uuid() {
  return crypto.randomUUID();
}

function readDemoItems() {
  try {
    return JSON.parse(localStorage.getItem(DEMO_KEY)) || [];
  } catch {
    return [];
  }
}

function writeDemoItems(items) {
  localStorage.setItem(DEMO_KEY, JSON.stringify(items));
}

function readDemoGoals() {
  try {
    return JSON.parse(localStorage.getItem(DEMO_GOALS_KEY)) || [];
  } catch {
    return [];
  }
}

function writeDemoGoals(goals) {
  localStorage.setItem(DEMO_GOALS_KEY, JSON.stringify(goals));
}

class DemoStore {
  constructor() {
    this.mode = 'demo';
    this._authCallbacks = [];
  }

  async init() {
    return { mode: this.mode };
  }

  onAuthChange(cb) {
    this._authCallbacks.push(cb);
    // Demo mode is always "signed in" as a local-only user.
    cb({ id: DEMO_USER_ID, email: 'demo@local' });
  }

  async getSession() {
    return { id: DEMO_USER_ID, email: 'demo@local' };
  }

  async signInWithPassword() {
    throw new Error('Demo Mode has no login — configure Supabase in js/config.js to enable accounts.');
  }

  async signUp() {
    throw new Error('Demo Mode has no login — configure Supabase in js/config.js to enable accounts.');
  }

  async signOut() {
    // no-op in demo mode
  }

  async listItems() {
    return readDemoItems().sort(
      (a, b) => new Date(b.date_added) - new Date(a.date_added)
    );
  }

  async addItem(item) {
    const items = readDemoItems();
    const now = new Date().toISOString();
    const full = {
      id: uuid(),
      user_id: DEMO_USER_ID,
      status: 'wishlist',
      rating: null,
      notes: null,
      date_completed: null,
      created_at: now,
      updated_at: now,
      date_added: now,
      ...item,
    };
    items.push(full);
    writeDemoItems(items);
    return full;
  }

  async updateItem(id, patch) {
    const items = readDemoItems();
    const idx = items.findIndex((i) => i.id === id);
    if (idx === -1) throw new Error('Item not found');
    items[idx] = { ...items[idx], ...patch, updated_at: new Date().toISOString() };
    writeDemoItems(items);
    return items[idx];
  }

  async deleteItem(id) {
    const items = readDemoItems().filter((i) => i.id !== id);
    writeDemoItems(items);
  }

  async addItems(newItems) {
    const items = readDemoItems();
    const now = new Date().toISOString();
    const added = newItems.map((item) => ({
      id: uuid(),
      user_id: DEMO_USER_ID,
      status: 'wishlist',
      rating: null,
      notes: null,
      date_completed: null,
      created_at: now,
      updated_at: now,
      date_added: now,
      ...item,
    }));
    writeDemoItems([...items, ...added]);
    return added;
  }

  async listGoals() {
    return readDemoGoals();
  }

  async upsertGoal(year, media_type, target) {
    const goals = readDemoGoals();
    const idx = goals.findIndex((g) => g.year === year && g.media_type === media_type);
    const now = new Date().toISOString();
    if (idx !== -1) {
      goals[idx] = { ...goals[idx], target, updated_at: now };
    } else {
      goals.push({ id: uuid(), user_id: DEMO_USER_ID, year, media_type, media_types: null, target, created_at: now, updated_at: now });
    }
    writeDemoGoals(goals);
    return goals.find((g) => g.year === year && g.media_type === media_type);
  }

  async createGoal(year, media_types, target) {
    const goals = readDemoGoals();
    const now = new Date().toISOString();
    const row = { id: uuid(), user_id: DEMO_USER_ID, year, media_type: null, media_types, target, created_at: now, updated_at: now };
    goals.push(row);
    writeDemoGoals(goals);
    return row;
  }

  async updateGoal(id, media_types, target) {
    const goals = readDemoGoals();
    const idx = goals.findIndex((g) => g.id === id);
    if (idx === -1) throw new Error('Goal not found');
    goals[idx] = { ...goals[idx], media_types, target, updated_at: new Date().toISOString() };
    writeDemoGoals(goals);
    return goals[idx];
  }
}

class SupabaseStore {
  constructor(cfg) {
    this.mode = 'supabase';
    this.cfg = cfg;
    this.client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  }

  async init() {
    return { mode: this.mode };
  }

  onAuthChange(cb) {
    this.client.auth.getSession().then(({ data }) => {
      cb(data.session ? data.session.user : null);
    });
    this.client.auth.onAuthStateChange((_event, session) => {
      cb(session ? session.user : null);
    });
  }

  async getSession() {
    const { data } = await this.client.auth.getSession();
    return data.session ? data.session.user : null;
  }

  async signInWithPassword(email, password) {
    const { error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async signUp(email, password) {
    const { error } = await this.client.auth.signUp({ email, password });
    if (error) throw error;
  }

  async signOut() {
    await this.client.auth.signOut();
  }

  async listItems() {
    const { data, error } = await this.client
      .from('items')
      .select('*')
      .order('date_added', { ascending: false });
    if (error) throw error;
    return data;
  }

  async addItem(item) {
    const { data: sessionData } = await this.client.auth.getSession();
    const user_id = sessionData.session.user.id;
    const { data, error } = await this.client
      .from('items')
      .insert([{ status: 'wishlist', ...item, user_id }])
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async updateItem(id, patch) {
    const { data, error } = await this.client
      .from('items')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async deleteItem(id) {
    const { error } = await this.client.from('items').delete().eq('id', id);
    if (error) throw error;
  }

  async addItems(newItems) {
    if (!newItems.length) return [];
    const { data: sessionData } = await this.client.auth.getSession();
    const user_id = sessionData.session.user.id;
    const rows = newItems.map((item) => ({ status: 'wishlist', ...item, user_id }));
    const chunkSize = 200;
    const added = [];
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const { data, error } = await this.client.from('items').insert(chunk).select();
      if (error) throw error;
      added.push(...data);
    }
    return added;
  }

  async listGoals() {
    const { data, error } = await this.client.from('goals').select('*');
    if (error) throw error;
    return data;
  }

  async upsertGoal(year, media_type, target) {
    const { data: sessionData } = await this.client.auth.getSession();
    const user_id = sessionData.session.user.id;
    const { data, error } = await this.client
      .from('goals')
      .upsert({ user_id, year, media_type, target }, { onConflict: 'user_id,year,media_type' })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async createGoal(year, media_types, target) {
    const { data: sessionData } = await this.client.auth.getSession();
    const user_id = sessionData.session.user.id;
    const { data, error } = await this.client
      .from('goals')
      .insert([{ user_id, year, media_type: null, media_types, target }])
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async updateGoal(id, media_types, target) {
    const { data, error } = await this.client
      .from('goals')
      .update({ media_types, target })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
}

export function createStore() {
  const cfg = window.MEDIA_JOURNAL_CONFIG || {};
  if (isConfigured(cfg) && window.supabase) {
    return new SupabaseStore(cfg);
  }
  return new DemoStore();
}

use adblock::engine::Engine;
use adblock::lists::{FilterSet, ParseOptions};
use std::sync::Arc;
use std::path::PathBuf;

// bundled filter lists — compiled at first startup, cached to disk
const EASYLIST: &str = include_str!("../adblock/easylist.txt");
const EASYPRIVACY: &str = include_str!("../adblock/easyprivacy.txt");
const ENGINE_FILE: &str = "adblock/engine.dat";

// compile engine from bundled lists, or deserialize from cache
pub fn init_engine(data_dir: &PathBuf) -> Arc<Engine> {
    let engine_path = data_dir.join(ENGINE_FILE);

    // try cached binary first (~5ms)
    if engine_path.exists() {
        if let Ok(data) = std::fs::read(&engine_path) {
            let mut engine = Engine::default();
            if engine.deserialize(&data).is_ok() {
                return Arc::new(engine);
            }
        }
    }

    // cold compile from text (~200-400ms, happens once)
    compile_and_cache(data_dir)
}

pub fn compile_and_cache(data_dir: &PathBuf) -> Arc<Engine> {
    let engine_path = data_dir.join(ENGINE_FILE);
    let mut filter_set = FilterSet::new(false);
    filter_set.add_filters(
        &EASYLIST.lines().collect::<Vec<_>>(),
        ParseOptions::default(),
    );
    filter_set.add_filters(
        &EASYPRIVACY.lines().collect::<Vec<_>>(),
        ParseOptions::default(),
    );

    let engine = Engine::from_filter_set(filter_set, true);

    // cache for fast next startup
    if let Some(parent) = engine_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let serialized = engine.serialize();
    let _ = std::fs::write(&engine_path, &serialized);

    Arc::new(engine)
}

// map webview2 resource context enum to adblock resource type string
pub fn resource_type_str(ctx: u32) -> &'static str {
    match ctx {
        2 => "document",
        3 => "stylesheet",
        4 => "image",
        5 => "media",
        6 => "font",
        7 => "script",
        8 => "xmlhttprequest",
        13 => "websocket",
        _ => "other",
    }
}

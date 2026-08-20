// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    app_lib::init_env_vars();
    if app_lib::audio::plugins::clap::run_describe_helper_from_args(std::env::args_os()) {
        return;
    }
    app_lib::run();
}

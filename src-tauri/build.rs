fn main() {
    // Application commands intentionally use Tauri's default local-origin access.
    // Adding an application permission manifest requires every registered command
    // to be granted or core commands such as http_get/http_post will be denied.
    tauri_build::build()
}

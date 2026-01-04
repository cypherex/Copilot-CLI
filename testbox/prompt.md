# Programming Language & Compiler Toolchain - Complete Specification

## Overview
Design and implement a complete, modern programming language with a full compiler toolchain, including lexer, parser, type checker, optimizer, code generator, runtime, standard library, package manager, debugger, and IDE support. The language should be statically typed with type inference, support both functional and imperative programming paradigms, compile to native code via LLVM, and provide memory safety without garbage collection through ownership and borrowing (Rust-inspired but with unique features).

## Language Design

### 1. Language Features

**Name:** Flux (for specification purposes)

**Syntax Philosophy:**
- Clean, minimal syntax without unnecessary punctuation
- Python-like indentation significance for blocks
- Rust-inspired ownership without lifetimes syntax
- ML-family type inference
- No semicolons required (newline-sensitive parsing)

**Type System:**
- Static typing with full type inference (Hindley-Milner with extensions)
- Algebraic data types (sum types and product types)
- Pattern matching with exhaustiveness checking
- Generics with trait bounds
- Higher-kinded types support
- Dependent types (basic, for array sizes and contracts)

**Memory Model:**
- Ownership system (similar to Rust but simpler)
- No explicit lifetime annotations (inferred automatically)
- Compile-time borrow checking
- No garbage collection or reference counting (except for explicitly opted-in `Rc`/`Arc`)
- Move semantics by default, copy semantics for primitive types
- Linear types for resources (files, sockets, etc.)

**Concurrency:**
- Actor model built into the language
- Async/await syntax for asynchronous operations
- Channels for message passing (both synchronous and asynchronous)
- Structured concurrency (no orphaned tasks)
- Data race freedom guaranteed at compile time

**Error Handling:**
- Result type for recoverable errors: `Result<T, E>`
- Panic for unrecoverable errors
- No exceptions (no try/catch)
- `?` operator for error propagation
- Compile-time exhaustiveness checking for error handling

**Core Language Constructs:**

```flux
// Variable bindings
let x = 42
let mut y = 100  // mutable binding

// Functions
fn add(a: i32, b: i32) -> i32:
    a + b

// Generic functions with constraints
fn max<T: Ord>(a: T, b: T) -> T:
    if a > b then a else b

// Structs
struct Point:
    x: f64
    y: f64

// Enums (algebraic data types)
enum Option<T>:
    Some(T)
    None

// Pattern matching
fn describe(opt: Option<i32>) -> String:
    match opt:
        Some(n) -> "Got {n}"
        None -> "Nothing"

// Traits (interfaces)
trait Drawable:
    fn draw(self) -> ()

impl Drawable for Point:
    fn draw(self):
        print("Point at ({self.x}, {self.y})")

// Actor definition
actor Counter:
    state: i32
    
    fn new() -> Self:
        Counter { state: 0 }
    
    fn increment(mut self):
        self.state += 1
    
    fn get(self) -> i32:
        self.state

// Async functions
async fn fetch_data(url: String) -> Result<String, Error>:
    let response = http::get(url).await?
    response.text().await

// Macros (procedural)
macro_rules! vec:
    ($($x:expr),*) => {
        let mut temp_vec = Vec::new()
        $(temp_vec.push($x))*
        temp_vec
    }
```

### 2. Standard Library

**Core Module (`std::core`):**
- Primitive types: i8, i16, i32, i64, i128, u8, u16, u32, u64, u128, f32, f64, bool, char, str
- Option<T>, Result<T,E>
- Basic operations and traits: Add, Sub, Mul, Div, Eq, Ord, Hash, Clone, Copy

**Collections (`std::collections`):**
- Vec<T> - Dynamic array
- HashMap<K,V> - Hash table
- HashSet<T> - Hash set
- LinkedList<T> - Doubly-linked list
- BTreeMap<K,V> - Ordered map
- BTreeSet<T> - Ordered set
- VecDeque<T> - Double-ended queue

**I/O (`std::io`):**
- File operations: read, write, open, create
- Buffered readers and writers
- Standard input/output/error
- Traits: Read, Write, Seek

**Networking (`std::net`):**
- TCP: TcpListener, TcpStream
- UDP: UdpSocket
- HTTP client and server (async)
- WebSocket support

**Concurrency (`std::sync`, `std::async`):**
- Mutex<T>, RwLock<T>
- Channels: channel(), mpsc, broadcast
- Atomic types
- Async runtime integration
- Actor spawning and supervision

**String Processing (`std::string`):**
- String (owned, growable UTF-8)
- &str (string slice, immutable view)
- String manipulation functions
- Regular expressions

**Time (`std::time`):**
- Duration, Instant, SystemTime
- Sleep, timeouts
- Clock operations

**Filesystem (`std::fs`):**
- Path operations
- Directory traversal
- File metadata
- Permissions

**Process (`std::process`):**
- Command execution
- Environment variables
- Exit codes

**Math (`std::math`):**
- Trigonometric functions
- Exponential and logarithmic
- Random number generation (crypto-secure option)

## Compiler Architecture

### 3. Lexer (Lexical Analysis)

**Token Types:**
- Keywords: fn, let, mut, if, else, match, struct, enum, trait, impl, async, await, actor, for, while, return, break, continue, import, export, pub, priv
- Identifiers: [a-zA-Z_][a-zA-Z0-9_]*
- Literals: integers, floats, strings, chars, booleans
- Operators: +, -, *, /, %, ==, !=, <, >, <=, >=, &&, ||, !, &, |, ^, <<, >>, =, +=, -=, etc.
- Delimiters: (, ), [, ], {, }, :, ->, ,, .
- Special: newline (significant), indent, dedent, EOF

**Lexer Requirements:**
- Handle indentation-based blocks (track indent stack)
- Support multi-line strings with """
- Character escape sequences: \n, \t, \r, \\, \", \', \u{XXXX}
- Comments: // single-line, /* */ multi-line, /// doc comments
- Error recovery: Report multiple errors in one pass
- Position tracking: Line, column, filename for error messages

**Implementation:**
- Hand-written lexer (no generator like flex)
- Implement as iterator over tokens
- Efficient: Single-pass, no backtracking
- Tokenize entire file into Vec<Token> with positions

### 4. Parser (Syntax Analysis)

**Grammar:**
- Design unambiguous context-free grammar
- Operator precedence: Defined precedence table (14 levels)
- Associativity: Left-associative by default, right for assignment
- No ambiguity in if-else, pattern matching

**Parser Type:**
- Recursive descent parser with operator precedence climbing
- LL(2) with limited lookahead
- Hand-written (no parser generator)

**AST (Abstract Syntax Tree):**
- Every node has span information (start/end position)
- Preserve comments for code formatting tools
- Support for incomplete/erroneous AST for IDE features

**AST Node Types:**
- Expressions: literal, identifier, binary_op, unary_op, call, index, field_access, lambda, match, if, block
- Statements: let, assignment, return, break, continue, expression_stmt
- Declarations: function, struct, enum, trait, impl, actor, import
- Patterns: literal, identifier, wildcard, struct, enum, tuple, slice
- Types: primitive, named, generic, function, tuple, array

**Error Recovery:**
- Synchronization points: After semicolons, closing braces, end of statement
- Report errors but continue parsing
- Generate partial AST for IDE use even with syntax errors
- Suggest fixes for common errors (missing closing brace, etc.)

### 5. Semantic Analysis

**Name Resolution:**
- Build symbol table with scopes (nested scopes)
- Resolve all identifiers to their declarations
- Handle imports and module system
- Detect shadowing and warn
- Resolve generic type parameters
- Check visibility (pub/priv)

**Type Checking:**
- Implement Hindley-Milner type inference with extensions
- Bi-directional type checking for better error messages
- Unification algorithm for type variables
- Trait resolution with type classes
- Generic instantiation
- Subtyping for numeric types (implicit conversion)
- Method resolution (including trait methods)

**Borrow Checking:**
- Ownership analysis: Track ownership transfer (moves)
- Borrow analysis: Shared (&T) vs. exclusive (&mut T) borrows
- Lifetime inference: Automatically infer lifetimes without annotations
- Detect use-after-move, use-after-free, data races
- Flow-sensitive analysis: Track borrows through control flow
- Handle loops, conditionals, pattern matching

**Other Analyses:**
- Pattern exhaustiveness checking (ensure all cases covered in match)
- Unreachable code detection
- Unused variable/function warnings
- Constant evaluation for array sizes and const generics
- Effect system for async/await tracking

**Error Messages:**
- Precise error location with source snippet
- Multi-line errors showing related locations
- Suggestions for fixes
- Educational explanations for borrow checker errors
- Color-coded terminal output

### 6. Intermediate Representation (IR)

**High-Level IR (HIR):**
- Desugar syntax into simpler form
- Explicit types everywhere (all inference resolved)
- Explicit moves and borrows
- Pattern matching lowered to decision trees
- Async/await lowered to state machines
- Still close to source for error reporting

**Mid-Level IR (MIR):**
- Control flow graph (CFG) representation
- Three-address code form
- Explicit control flow (no structured if/while)
- Basic blocks and edges
- Used for borrow checking and optimization

**Low-Level IR (LLVM IR):**
- Generate LLVM IR for code generation
- LLVM handles final optimizations and code generation

**IR Transformations:**
- Constant folding and propagation
- Dead code elimination
- Inline expansion of small functions
- Loop optimizations (unrolling, vectorization)
- Escape analysis (stack vs heap allocation)
- Devirtualization (for trait objects)

### 7. Code Generation

**LLVM Backend:**
- Generate LLVM IR from MIR
- LLVM optimization passes: O0, O1, O2, O3, Os
- Link-time optimization (LTO) support
- Cross-compilation: Support multiple targets (x86_64, ARM, WASM)

**Memory Layout:**
- Struct layout: Optimal field ordering for alignment
- Enum layout: Tagged union with discriminant
- Fat pointers: For slices and trait objects
- Stack vs heap: Escape analysis determines allocation

**Calling Conventions:**
- Follow platform ABI (System V for Unix, Microsoft for Windows)
- Efficient passing of small structs by value
- Name mangling for generic functions

**Runtime Support:**
- Panic handling: Unwind stack, run destructors
- Allocator: Default to system allocator, support custom allocators
- Reflection data (minimal, for debugging)

**Output Formats:**
- Executable binaries
- Static libraries (.a, .lib)
- Shared libraries (.so, .dylib, .dll)
- WASM modules

### 8. Build System & Package Manager

**Build Tool: `fluxbuild`**

**Project Structure:**
```
my_project/
  Flux.toml          # Package manifest
  src/
    main.flux        # Entry point
    lib.flux         # Library root
    module/
      mod.flux       # Module declaration
  tests/
    integration_test.flux
  benches/
    benchmark.flux
  examples/
    example.flux
```

**Flux.toml Format:**
```toml
[package]
name = "my_project"
version = "0.1.0"
authors = ["Your Name <email@example.com>"]
edition = "2024"

[dependencies]
http = "1.2.3"
json = { version = "2.0", features = ["serde"] }
local_lib = { path = "../local_lib" }

[dev-dependencies]
test_framework = "0.5"

[profile.release]
opt_level = 3
lto = true

[profile.dev]
opt_level = 0
debug = true
```

**Commands:**
- `fluxbuild new <name>` - Create new project
- `fluxbuild build` - Compile project
- `fluxbuild run` - Build and run
- `fluxbuild test` - Run tests
- `fluxbuild bench` - Run benchmarks
- `fluxbuild doc` - Generate documentation
- `fluxbuild check` - Type check without code generation (fast)
- `fluxbuild clean` - Remove build artifacts
- `fluxbuild publish` - Publish to package registry

**Dependency Resolution:**
- Semver-based versioning
- Dependency graph solver (handles conflicts)
- Lock file (Flux.lock) for reproducible builds
- Support git dependencies with commit/branch/tag
- Private package registry support

**Caching:**
- Incremental compilation: Only recompile changed modules
- Artifact caching: Store compiled artifacts
- Dependency caching: Download once, reuse

**Package Registry:**
- Central registry (like crates.io)
- REST API for package publishing and searching
- Authentication with API tokens
- Documentation hosting (auto-generated from doc comments)

### 9. Debugger

**Debugger Features:**
- Source-level debugging (not just assembly)
- Breakpoints: Line breakpoints, conditional breakpoints, watchpoints
- Stepping: Step over, step into, step out
- Variable inspection: Print locals, watch expressions
- Call stack inspection
- Multi-threaded debugging: Thread switching, thread-specific breakpoints
- Async task debugging: See pending tasks, task states

**Debug Information:**
- Generate DWARF debug info
- Map machine code back to source lines
- Variable location tracking (register, stack, heap)
- Inline function tracking

**Debugger Interface:**

Command-line debugger: `fluxdb`

```
$ fluxdb ./my_program
(fluxdb) break main.flux:42
Breakpoint 1 at main.flux:42
(fluxdb) run
Breakpoint 1 hit at main.flux:42
(fluxdb) print x
x = 42
(fluxdb) next
(fluxdb) backtrace
#0  foo() at main.flux:42
#1  bar() at main.flux:30
#2  main() at main.flux:10
(fluxdb) continue
```

**IDE Integration:**
- DAP (Debug Adapter Protocol) implementation
- JSON-RPC based protocol
- Support breakpoints, stepping, variable inspection in IDEs

### 10. IDE Support

**Language Server Protocol (LSP):**

Implement `fluxlsp` - Language server providing:
- Auto-completion: Context-aware suggestions
- Go to definition: Jump to symbol definition
- Find references: Find all uses of symbol
- Hover information: Type and documentation on hover
- Inline diagnostics: Show errors/warnings as you type
- Code actions: Quick fixes, refactoring suggestions
- Formatting: Auto-format code
- Rename symbol: Rename with all references updated
- Document symbols: Outline view of file structure
- Workspace symbols: Search across project

**Incremental Parsing:**
- Reparse only changed portions of file
- Maintain AST across edits
- Fast response time (<100ms for most operations)

**IDE Plugins:**
- Provide plugins for: VS Code, IntelliJ, Vim, Emacs
- Syntax highlighting
- Bracket matching, auto-indent
- Snippet support
- Build integration

### 11. Formatter

**Code Formatter: `fluxfmt`**

**Formatting Rules:**
- Consistent indentation (4 spaces, configurable)
- Maximum line length (100 characters, configurable)
- Trailing comma insertion
- Import sorting and grouping
- Alignment of struct fields, pattern arms
- Blank line rules (around functions, before/after blocks)

**Configuration:**
```toml
# .fluxfmt.toml
max_width = 100
indent_style = "spaces"
indent_width = 4
trailing_comma = "always"
reorder_imports = true
```

**Usage:**
- `fluxfmt file.flux` - Format file in place
- `fluxfmt --check` - Check if files need formatting (CI use)
- `fluxfmt --config custom.toml` - Use custom config

**IDE Integration:**
- Format on save
- Format selection
- Format on paste

### 12. Linter

**Linter: `fluxlint`**

**Lint Categories:**
- Style: Naming conventions, unused imports, redundant code
- Correctness: Potential bugs, type mismatches
- Performance: Inefficient patterns, unnecessary allocations
- Complexity: High cyclomatic complexity, deep nesting
- Safety: Unsafe patterns, potential panics
- Idioms: Non-idiomatic code, suggest better alternatives

**Example Lints:**
- `unused_variable` - Variable declared but never used
- `needless_borrow` - Unnecessary borrow operator
- `inefficient_to_string` - Use format! instead of repeated concatenation
- `missing_docs` - Public items without documentation
- `too_many_arguments` - Function with >7 arguments
- `deeply_nested` - Control flow nesting >4 levels

**Configuration:**
```toml
# .fluxlint.toml
[lints]
unused_variable = "warn"
missing_docs = "deny"
too_many_arguments = { level = "warn", max = 5 }
```

**Usage:**
- `fluxlint` - Lint entire project
- `fluxlint file.flux` - Lint specific file
- `fluxlint --fix` - Apply automatic fixes
- Integrated into `fluxbuild check`

### 13. Testing Framework

**Test Syntax:**

```flux
// Unit tests
#[test]
fn test_addition():
    assert_eq(add(2, 3), 5)

#[test]
#[should_panic]
fn test_division_by_zero():
    divide(10, 0)

// Property-based testing
#[property_test]
fn prop_addition_commutative(a: i32, b: i32):
    assert_eq(add(a, b), add(b, a))

// Benchmark
#[bench]
fn bench_sorting(b: &mut Bencher):
    let data = generate_random_data(1000)
    b.iter(|| sort(data.clone()))
```

**Test Runner:**
- Run tests in parallel
- Capture test output
- Test filtering: Run specific tests
- Verbose mode: Show all output
- JUnit XML output for CI
- Code coverage instrumentation

**Mocking & Stubs:**
- Trait-based mocking
- Mock framework for common patterns
- Test fixtures

**Integration Testing:**
- Separate integration test directory
- Test cross-module interactions
- End-to-end testing support

### 14. Documentation Generator

**Doc Comments:**
```flux
/// Adds two numbers together.
///
/// # Examples
///
/// ```flux
/// let result = add(2, 3)
/// assert_eq(result, 5)
/// ```
///
/// # Panics
///
/// Never panics.
fn add(a: i32, b: i32) -> i32:
    a + b
```

**Documentation Generator: `fluxdoc`**

**Output:**
- HTML documentation website
- Searchable index
- Cross-referenced: Click types to see their documentation
- Source code links
- Examples are syntax-highlighted and tested
- Markdown support in doc comments

**Features:**
- Module hierarchy navigation
- Search functionality
- Responsive design (mobile-friendly)
- Dark mode support
- Export to PDF/EPUB

### 15. REPL (Read-Eval-Print Loop)

**Interactive Shell: `flux`**

```
$ flux
Flux 1.0.0 REPL
Type :help for help
>>> let x = 42
>>> x + 8
50
>>> fn factorial(n: i32) -> i32:
...     if n <= 1 then 1 else n * factorial(n - 1)
>>> factorial(5)
120
>>> :type x
i32
>>> :help
Available commands:
  :type <expr>  - Show type of expression
  :doc <name>   - Show documentation
  :quit         - Exit REPL
```

**REPL Features:**
- Multi-line input with indentation tracking
- History (arrow keys, search with Ctrl+R)
- Auto-completion (Tab)
- Syntax highlighting
- Import modules
- Load files: `:load file.flux`
- Save session: `:save session.flux`

### 16. Cross-Compilation & Portability

**Target Platforms:**
- x86_64-linux-gnu
- x86_64-linux-musl (static linking)
- x86_64-apple-darwin
- aarch64-apple-darwin (Apple Silicon)
- x86_64-windows-msvc
- x86_64-windows-gnu
- aarch64-linux-gnu (ARM64 Linux)
- wasm32-unknown-unknown (WebAssembly)

**Cross-Compilation:**
- `fluxbuild build --target <target-triple>`
- Download and cache cross-compilation toolchains
- Support for custom target specifications

**Platform Abstractions:**
- Conditional compilation: #[cfg(target_os = "linux")]
- Platform-specific modules in standard library
- FFI for calling C libraries
- Stable ABI for shared libraries

### 17. Foreign Function Interface (FFI)

**C Interop:**

```flux
// Import C function
extern "C":
    fn printf(format: *const u8, ...) -> i32

// Export Flux function to C
#[no_mangle]
extern "C" fn flux_add(a: i32, b: i32) -> i32:
    a + b

// C struct interop
#[repr(C)]
struct CPoint:
    x: f64
    y: f64
```

**Safety:**
- All FFI calls are `unsafe`
- Raw pointers: *const T, *mut T
- Manual memory management when interfacing with C
- Wrapper types for safe abstractions over FFI

### 18. Performance & Optimization

**Compiler Optimizations:**
- Inlining: Aggressive inline for small functions
- Loop optimizations: Unrolling, vectorization (SIMD)
- Devirtualization: Static dispatch where possible
- Escape analysis: Stack allocation for short-lived data
- Dead code elimination: Remove unused code
- Constant folding: Evaluate constants at compile time
- Tail call optimization: Eliminate tail recursion

**Profile-Guided Optimization (PGO):**
- Collect runtime profile data
- Use profile to guide optimizations
- `fluxbuild build --profile generate` → run program → `fluxbuild build --profile use`

**Benchmarking:**
- Built-in benchmark framework
- Statistical analysis of results
- Compare with baseline
- Microbenchmarks and integration benchmarks

**Performance Targets:**
- Compile time: <1 second per 10,000 lines for incremental builds
- Binary size: Comparable to C (with LTO and stripping)
- Runtime performance: Within 10% of equivalent C/C++ for CPU-bound tasks
- Memory usage: Minimal overhead, no GC pauses

### 19. Error Handling & Recovery

**Compiler Error Messages:**
- Precise source location
- Multi-span errors (show related locations)
- Suggestions for fixes
- Error codes (E0001, E0002, etc.) with online explanations
- Color-coded output
- Maximum 10 errors before stopping (configurable)

**Example Error Message:**
```
error[E0382]: use of moved value: `x`
  --> main.flux:5:9
   |
3  |     let y = x
   |             - value moved here
4  |     print(x)
   |           ^ value used after move
   |
   = note: move occurs because `x` has type `String`, which does not implement the `Copy` trait
help: consider cloning the value if performance is not an issue
   |
3  |     let y = x.clone()
   |               ++++++++
```

**Runtime Error Messages:**
- Stack traces with source locations
- Clear panic messages
- Configurable panic behavior (abort vs unwind)

### 20. Standard Library Implementation

**Collections Implementation:**
- Vec<T>: Dynamic array with exponential growth (capacity * 1.5)
- HashMap<K,V>: Robin Hood hashing, FNV hash by default
- HashSet<T>: Wrapper around HashMap<T, ()>
- LinkedList<T>: Intrusive doubly-linked list
- Performance targets: Vec push O(1) amortized, HashMap get O(1) average

**I/O Implementation:**
- Buffered I/O: 8KB buffers by default
- Async I/O: epoll on Linux, kqueue on BSD/macOS, IOCP on Windows
- Zero-copy when possible (sendfile, splice)

**Concurrency Primitives:**
- Mutex: Futex-based on Linux, OS primitives on other platforms
- RwLock: Reader-writer lock with writer preference
- Atomic: Use CPU atomic instructions
- Actor runtime: Work-stealing task scheduler

### 21. Security

**Memory Safety:**
- No buffer overflows (bounds checking)
- No use-after-free (ownership system)
- No data races (borrow checker)
- No null pointer dereferences (no null, use Option)

**Dependency Security:**
- Dependency auditing: Check for known vulnerabilities
- Lock file integrity: Verify checksums
- Supply chain attacks: Pin dependencies, verify signatures

**Sandboxing:**
- WASM compilation for sandboxed execution
- Capability-based security for system access

### 22. Testing Requirements

**Unit Tests:**
- Test each compiler phase independently
- Test standard library functions
- Target: >90% code coverage

**Integration Tests:**
- End-to-end compilation tests
- Test entire toolchain: compile, run, verify output
- Test error recovery
- Test cross-compilation

**Fuzzing:**
- Fuzz lexer with random bytes
- Fuzz parser with random token sequences
- Fuzz type checker with random programs
- Use AFL, libFuzzer

**Differential Testing:**
- Compare against reference implementations
- Test optimizations don't change semantics

### 23. Documentation Requirements

**Language Specification:**
- Formal grammar specification
- Type system rules
- Memory model documentation
- Standard library reference

**User Documentation:**
- "The Flux Book": Comprehensive guide
- Tutorial for beginners
- Advanced topics: Macros, unsafe, FFI
- Idioms and patterns

**Developer Documentation:**
- Compiler internals guide
- Contributing guide
- Architecture documentation
- API documentation for all public APIs

### 24. Deliverables

- [ ] Lexer
- [ ] Parser
- [ ] Type checker
- [ ] Borrow checker
- [ ] Code generator (LLVM backend)
- [ ] Standard library (complete implementation)
- [ ] Build tool (`fluxbuild`)
- [ ] Package manager integration
- [ ] Debugger (`fluxdb`)
- [ ] Language server (`fluxlsp`)
- [ ] Formatter (`fluxfmt`)
- [ ] Linter (`fluxlint`)
- [ ] Documentation generator (`fluxdoc`)
- [ ] REPL (`flux`)
- [ ] IDE plugins (VS Code at minimum)
- [ ] Test framework
- [ ] Complete test suite (>90% coverage)
- [ ] Documentation (Language spec, user guide, developer guide)
- [ ] Example programs (at least 20 diverse examples)
- [ ] Benchmarks comparing to C, C++, Rust

### 25. Constraints

**Implementation Language:**
- Compiler: Rust
- Standard library runtime: Flux itself (self-hosting goal) + minimal Rust/C runtime
- Build system: Rust
- Tooling: Rust

**Code Quality:**
- All tools pass clippy
- Formatted with rustfmt
- Comprehensive error handling
- Extensive testing

**Performance:**
- Compiler speed: <10 seconds for 100K lines from scratch
- Incremental compilation: <1 second for small changes
- Generated code: Competitive with C++/Rust

This specification defines a complete programming language ecosystem that would require maintaining consistency across lexing, parsing, type checking, code generation, a large standard library, and numerous tools, all while implementing complex algorithms like type inference and borrow checking.
# 逐行解析Vuex源码

## Vuex 背后的基本思想

### 查询和更新的分离
Vuex 很重要的一个特点是：查询和更新的分离：

1. 如果一个方法修改了 state，那它就是一个 command 命令，并不返回值。
2. 如果一个方法返回了值，那它就是一个 query 查询，并不修改 state。

这保证了状态以一种“可预测”的方式变化。

Vuex 把组件间需要共享的 state 抽取出来，以一个全局的 store 的单例模式统一管理。从而构成一个“状态树”，任何组件都能获取状态或触发状态的更新。

### Vuex 和单纯的全局对象的不同在于

1. Vuex 的 state 是响应式的，当组件从 store 中读取状态时，如果状态发生变化，则相应的组件也会更新，这就是 query 的一种实现。
2. 不能直接修改 store 中的状态，改变它的唯一方式是提交 mutation，这样使我们可以方便地追踪每一个状态的变化，这就是 command 的一种实现。

Vuex 并没有实现一套响应式系统，而是借用了 Vue 的 API 实现数据的响应式化，所以 Vuex 要 配合 Vue 使用，不适合非 Vue 框架。

## Vuex的安装

> 在一个模块化的打包系统中，必须在 new Vue() 之前调用 Vue.use() 才能使用 Vuex 插件：

```js
import Vue from 'vue';
import Vuex from 'vuex';
Vue.use(vuex);
new Vue({
  // ...
})
```

> 安装 Vue.js 插件。如果插件是一个对象，它必须提供 install 方法。如果插件是一个函数，则它会被作为 install 方法。install 方法调用时，会将 Vue 作为参数传入。

入口文件 src\index.js 默认导出的对象：

```js
export default {
  Store,
  install,
  version: '__VERSION__',
  mapState,
  mapMutations,
  mapGetters,
  mapActions,
  createNamespacedHelpers
}
```
Vuex 对外暴露的对象包含 install 方法。Vue.use 执行，会调用插件的 install 方法，传入 Vue 构造函数。

```js
let Vue
// ....
export function install (_Vue) {
  if (Vue && _Vue === Vue) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[vuex] already installed. Vue.use(Vuex) should be called only once.')
    }
    return
  }
  Vue = _Vue
  applyMixin(Vue)
}
```
首次调用 install 时，本地 Vue 还未定义，接收传入的 Vue 构造函数，避免打包时整个引入 Vue。接着执行 applyMixin 做真正的安装。

再次调用 install 时，Vue 已经有值，在开发环境下会打印警告：Vuex 已经安装过，Vue.use(Vuex) 只需调用一次。直接返回，避免插件的重复安装。

```js
export default function (Vue) {
  const version = Number(Vue.version.split('.')[0])
  if (version >= 2) {
    Vue.mixin({ beforeCreate: vuexInit })
  } else {
    // Vue 1.x，不做分析
  }
}
``` 

Vue 2.x 版本调用 Vue.mixin，混入 beforeCreate 生命周期钩子: vuexInit。之后创建的每个组件实例，执行到 beforeCreate 钩子时都会调用 vuexInit。

```js
function vuexInit () {
  const options = this.$options
  if (options.store) {
    this.$store = typeof options.store === 'function'
      ? options.store()
      : options.store
  } else if (options.parent && options.parent.$store) {
    this.$store = options.parent.$store
  }
}
```

vuexInit 函数中 this 指向当前 vm 实例。如果 vm.$options.store 存在，说明当前的 Vue 实例是根实例，因为只有在创建根 Vue 实例时，才会传入 store 对象：

```js
new Vue({
  store, // 传入store对象
  render: h => h(App)
}).$mount('#app')
```

给根实例添加 $store 属性，值为 options.store() 或 options.store，取决于传的 store 是否为函数。

如果当前不是根实例，但它有父实例且父实例的 $store 有值，则也给当前实例添加 $store 属性，值取父实例的 $store 值。

因为每个 vm 实例的生命周期都会执行 vuexInit 钩子，组件的创建是自上而下的，根实例注册的 store 对象会向下注入到各个组件实例中，根实例和子实例都添加了 $store 属性，属性值指向同一个 store，即 new Vue 时传的 store。任意组件中都可以通过 this.$store 访问到它。

## store 对象的创建

这个 store 对象是通过实例化 Vuex.Store 创建的：

```js
const store = new Vuex.Store({
  state,
  mutations,
  actions,
  getters,
  modules
})
```
传入一个用户定义的配置对象，可以包含 actions、getters、state、mutations、modules 等

我们分段来看 Store 这个构造函数：

```js
class Store {
  constructor(options = {}) {
    if (!Vue && typeof window !== 'undefined' && window.Vue) {
      install(window.Vue)
    }
    if (process.env.NODE_ENV !== 'production') {
      assert(Vue, `must call Vue.use(Vuex) before creating a store instance.`)
      assert(typeof Promise !== 'undefined', `vuex requires a Promise polyfill in this browser.`)
      assert(this instanceof Store, `store must be called with the new operator.`)
    }
    // ……
  }
  // ……
}
```

如果本地 Vue 没有值，且处在浏览器环境，且 window.Vue 存在，这说明还没有安装 Vuex，而且是使用全局 <script> 标签引入 Vuex，会主动调用 install 安装，不需要用户手动调用 Vue.use(Vuex)。

在开发环境中，会执行3个断言函数，如果条件不具备则会抛错。

```js
export function assert (condition, msg) {
  if (!condition) throw new Error(`[vuex] ${msg}`)
}
```
3个断言函数所做的事是：

1. 如果本地 Vue 没有值，抛错：实例化 Store 之前必须调用 Vue.use(Vuex)。
2. 如果 Promise 不能用，抛错：Vuex 需要依赖 Promise。
3. 如果 Store 函数里的 this 不是 Store 实例，抛错：Store 必须用 new 调用。

判断完环境后，往 Store 实例挂载一些属性：

```js
const { plugins = [], strict = false } = options
this._committing = false // 正在commit mutation的标志
this._actions = Object.create(null) // 存放用户定义的所有actions
this._actionSubscribers = [] // action订阅函数集合
this._mutations = Object.create(null) // 存放用户定义的所有mutations
this._wrappedGetters = Object.create(null) // 存放用户定义的所有getters
this._modules = new ModuleCollection(options) // module收集器
this._modulesNamespaceMap = Object.create(null) // 模块命名空间
this._subscribers = [] // 所有mutation的订阅函数
this._watcherVM = new Vue() // Vue实例，利用它的$watch方法来观测变化 
this._makeLocalGettersCache = Object.create(null)//存放生成的本地getters的缓存
// ...
```

其中的重点是：`this._modules = new ModuleCollection(options)`，稍后会仔细介绍 ModuleCollection，继续看 Store：
 
```js
const store = this
const { dispatch, commit } = this
this.dispatch = function boundDispatch (type, payload) {
  return dispatch.call(store, type, payload)
}
this.commit = function boundCommit (type, payload, options) {
  return commit.call(store, type, payload, options)
}
```
给 store 实例添加 dispatch 和 commit 方法，分别实际调用 Store 原型的 dispatch 和 commit 方法，这不是多此一举，而是为了保证执行时的 this 始终指向 store 实例。store 被 Store 函数内定义的函数引用，形成闭包，store 始终驻留在内存中，可以被引用到。

这样 store.commit/store.dispatch 在别的函数内调用时，this 依然指向 store 实例，比如在 dispatch 中调用 commit，或在 mutation handler 中调用 commit 提交另一个 mutation。

继续看 Store 构造函数：

```js
this.strict = strict // options的strict值赋给实例的strict
const state = this._modules.root.state
installModule(this, state, [], this._modules.root)
resetStoreVM(this, state)
plugins.forEach(plugin => plugin(this))
```

然后获取根 state。this._modules 是 ModuleCollection 的实例，它的 root 是根模块对象，根模块的 state 是根state。后面会讲到。

调用 installModule 进行模块的安装，传入 store 实例、根state、[]、根 module。

调用 resetStoreVM 函数，对 state 进行响应式化处理。

遍历 plugins 数组，逐个调用 Vuex 自己的插件函数，进行插件的安装。

到目前为止，Store 构造函数已经过了一遍。new Store 主要做了三件事：

1. 初始化一些内部属性，重点是 this._modules = new ModuleCollection(options)
2. 执行 installModule，安装模块
3. 执行 resetStoreVM，使store响应式化

我们将逐个细说这三个，我们先看实例化 Store 时配置对象该怎么传：

## 传入 Store 的配置对象

```js
class ModuleCollection {
  constructor (rawRootModule) {
    this.register([], rawRootModule, false)
  }
}
```
new ModuleCollection(options) 会调用 register 函数。
```js
register (path, rawModule, runtime = true) {
  if (process.env.NODE_ENV !== 'production') {
    assertRawModule(path, rawModule)
  }
  // ...
}
```
开发环境下，会调用 assertRawModule 函数，对用户传入的配置对象做规范化校验。

```js
function assertRawModule (path, rawModule) {
  Object.keys(assertTypes).forEach(key => {
    if (!rawModule[key]) return
    const assertOptions = assertTypes[key]
    forEachValue(rawModule[key], (value, type) => {
      assert(
        assertOptions.assert(value),
        makeAssertionMessage(path, key, type, value, assertOptions.expected)
      )
    })
  })
}
```
首先会获取 assertTypes 的自有属性组成的数组，我们看看 assertTypes 对象：

```js
const functionAssert = {
  assert: value => typeof value === 'function',
  expected: 'function'
}
const objectAssert = {
  assert: value => typeof value === 'function' ||
    (typeof value === 'object' && typeof value.handler === 'function'),
  expected: 'function or object with "handler" function'
}
const assertTypes = {
  getters: functionAssert,
  mutations: functionAssert,
  actions: objectAssert
}
```
可见，Object.keys(assertTypes) 就是 ['getters','mutations','actions']

```js
Object.keys(assertTypes).forEach(key => {
    if (!rawModule[key]) return
    const assertOptions = assertTypes[key]
    forEachValue(rawModule[key], (value, type) => {
      assert(
        assertOptions.assert(value),
        makeAssertionMessage(path, key, type, value, assertOptions.expected)
      )
    })
  })
```
遍历 ['getters','mutations','actions']，执行回调，首先如果当前配置对象中不存在当前遍历的属性，直接返回。比如配置对象中没有传 actions，则不用校验 actions。
 
否则，获取 assertTypes 对象中对应的属性值，赋给 assertOptions，比如 'getters' 的属性值就是 functionAssert 对象

接着调用 forEachValue 函数对 key 对应的配置对象进行遍历。我们先看看 forEachValue 函数：

```js
export function forEachValue (obj, fn) {
  Object.keys(obj).forEach(key => fn(obj[key], key))
}
```

forEachValue 函数会遍历传入的 obj 对象的自有属性 key，逐个调用 fn。
```js
forEachValue(rawModule[key], (value, type) => {
  assert(
    assertOptions.assert(value),
    makeAssertionMessage(path, key, type, value, assertOptions.expected)
  )
})
```
forEachValue 会遍历 key 对应的属性值对象，执行回调，执行 assert 函数：如果 assertOptions.assert(value) 返回 false，则抛出错误。

当 key 为 'getters' 或 'mutations'，则 assertOptions.assert 为函数 `value => typeof value === 'function'`

意味着，用户传的 getters 和 mutations 对象中的属性值需要传函数，否则会抛错。

当 key 为 'actions'，则 assertOptions.assert 函数就是：

```js
value => typeof value === 'function' ||
    (typeof value === 'object' && typeof value.handler === 'function')
```

意味着，用户传的 actions 对象中的属性值可以是函数，也可以是包含 handler 方法的对象，否则会抛错。

所以 assertRawModule 函数校验用来户传入的 getters、mutations、actions 对象，如果没有按要求传就会抛错，给出提示。

## Module 收集

> store 使用单一的状态树，用一个对象包含了全部的应用层级的状态，每个应用将仅仅包含一个 store 实例。

如果应用变得很复杂，store 对象就可能很臃肿。为了解决这个问题，Vuex 允许我们将 store 分割成模块，每个模块都有自己的 state 、mutation、action、getter、甚至是嵌套模块，像下面这样从上至下进行同样方式的分割：

```js
const moduleA = {
  state: { ... },
  mutations: { ... },
  actions: { ... },
  getters: { ... }
}
const moduleB = {
  state: { ... },
  mutations: { ... },
  actions: { ... }
}
const store = new Vuex.Store({
  modules: {
    a: moduleA,
    b: moduleB
  }
})
store.state.a // -> moduleA 的状态
store.state.b // -> moduleB 的状态
```

如果把 store 本身看作是根 module，它有嵌套的子 module，形成一种用配置对象描述的树形结构。模块的收集其实靠 new ModuleCollection 实现的。

```js
class ModuleCollection {
  constructor (rawRootModule) {
    this.register([], rawRootModule, false)
  }
  register (path, rawModule, runtime = true) {
    if (process.env.NODE_ENV !== 'production') {
      assertRawModule(path, rawModule)
    }
    const newModule = new Module(rawModule, runtime)
    if (path.length === 0) {
      this.root = newModule
    } else {
      const parent = this.get(path.slice(0, -1))
      parent.addChild(path[path.length - 1], newModule)
    }
    if (rawModule.modules) {
      forEachValue(rawModule.modules, (rawChildModule, key) => {
        this.register(path.concat(key), rawChildModule, runtime)
      })
    }
  }
  // ...
}
```
register 原型方法接收的 3 个参数：

1. path：路径，是模块配置对象的属性名组成的数组，是模块的唯一标识。像刚刚的例子，根模块的 path 为[]，它的子模块 moduleA 的 path 是 ['a']，子模块 moduleB 的 path 是 ['b']，如果它们各自还有子模块，则 path 就大致形如 ['a','a1']、['b','b1']
2. rawModule：当前模块的配置对象。rawRootModule 就是实例化 Store 时传入的配置对象。我们把创建的 store 对象看作是根 module，它的配置对象看作根 module 的配置对象。
3. runtime 表示是否是一个运行时创建的 module，默认为 true。

```js
this.register([], rawRootModule, false)
```
new ModuleCollection 实际调用 register，传入 []，说明注册的是根 module。rawRootModule 是实例化 Store 时传入的配置对象。

我们分段看 register：

```js
if (process.env.NODE_ENV !== 'production') {
  assertRawModule(path, rawModule) // 对配置对象做规范化校验
}
const newModule = new Module(rawModule, runtime)
if (path.length === 0) {
  this.root = newModule
} else {
  const parent = this.get(path.slice(0, -1))
  parent.addChild(path[path.length - 1], newModule)
}
```

根据当前的配置对象创建一个 Module 实例，赋给 newModule。后面会详谈 Module 构造函数。

如果 path 是空数组，说明当前注册的是根模块，则把创建的根模块对象赋给当前 ModuleCollection 实例的 root 属性。

如果 path 不是空数组，说明当前注册的是子模块，稍后会讲解。接着：

```js
if (rawModule.modules) {
  forEachValue(rawModule.modules, (rawChildModule, key) => {
    this.register(path.concat(key), rawChildModule, runtime)
  })
}
```
如果当前配置对象传了嵌套子模块，则遍历 modules 对象里的每个子模块名 key，递归调用 register，传入的路径是 path.concat(key)，就是当前注册的模块的子模块的路径。第二个参数是子模块的配置对象。

我们现在捋一捋：实例化 Store 会实例化 MoudleCollection，调用 register 进行根 module 的注册，如果根配置对象配置了嵌套的子模块，会继续调用 register 注册子 module，此时 path 不是空数组，回到刚刚的 else 语句块:

```js
if (path.length === 0) {
  this.root = newModule
} else {
  const parent = this.get(path.slice(0, -1))
  parent.addChild(path[path.length - 1], newModule)
}
```

path 是当前注册的子模块的路径，path.slice(0, -1) 是父模块的 path，传入 get 方法执行，获取当前子模块的父 module 对象，我们看看 get 方法：

```js
get (path) {
  return path.reduce((module, key) => {
    return module.getChild(key)
  }, this.root)
}
```

reduce 的详细用法参考 [reduce](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Array/Reduce)

我们先看一下 getChild 和 addChild 这两个 Module 的原型方法，再回来理解 get。

```js
getChild (key) {
  return this._children[key]
}
addChild (key, module) {
  this._children[key] = module
}
```

getChild 方法返回 this._children[key]，即通过 key 获取到当前模块的子模块对象，我们讲 Module 构造函数时会讲 _children 属性。

addChild 方法是往当前模块的 _children 对象中添加 key 和对应的子模块对象。

回到 get 原型方法：

```js
get (path) {
  return path.reduce((module, key) => {
    return module.getChild(key)
  }, this.root)
}
```

假设传入的 path 为 ['a','b','c']。reduce 累加器的初始值为根模块，第一次迭代中，执行回调返回模块名为 'a' 的子模块，并且它会作为下次迭代的累加器的值，即传给回调的第一个参数 module，第二次迭代执行返回 'a' 模块下的 'b' 子模块对象，以此类推，最后返回 ['a','b','c'] 对应的模块。

所以 get 方法是根据 path 返回对应的 module 对象。

```js
const parent = this.get(path.slice(0, -1))
parent.addChild(path[path.length - 1], newModule)
```

path 数组的最后一项，即当前模块名，newModule 是当前模块对象，它们被添加到父模块对象的 _children 对象中。

依靠模块的 _children 属性，父子模块对象之间建立起联系。一个树形结构的配置对象，转成了一个个散落的有父子关系的 module 对象。

概况来说，new ModuleCollection，做了两件事：

1. 根据未加工的配置对象通过 new Module 创建 module 对象
2. 建立父子 module 对象之间的联系

new Module 是在 new ModuleCollection 的过程中发生的，先生成模块对象，再建立父子模块对象的联系。

## Module 构造函数

用户定义模块的配置对象传入 new Moudle 执行后，生成 module 对象。

```js
class Module {
  constructor (rawModule, runtime) {
    this.runtime = runtime
    this._children = Object.create(null)
    this._rawModule = rawModule
    const rawState = rawModule.state
    this.state = (typeof rawState === 'function' ? rawState() : rawState) || {}
  }
  get namespaced () {
    return !!this._rawModule.namespaced
  }
  // 原型方法后续会介绍
}
```

Module 的实例会挂载 _children 属性，值为一个用来存放当前模块的子模块对象的对象。_rawModule 属性，保存当前模块的配置对象。

获取配置对象中的 state 赋给 rawState。给 Module 实例添加 state 属性，属性值为 rawState() 或 rawState，取决于 rawState 是否为函数，如果当前模块的配置对象没有传 state，则赋为一个空对象。

和组件里的 data 一样，用户声明模块的 state 可以传一个返回一个对象的函数。如果 state 选项传的是纯对象，则该 state 对象会通过引用被共享，导致它被修改时，store 或模块间数据相互污染。

因为有时我们可能需要创建一个模块的多个实例，比如，多次 new Store 创建多个 store 实例，或在一个 store 中多次注册同一个模块。

```js
get namespaced () {
  return !!this._rawModule.namespaced
}
```

namespaced 是 Module 的原型属性，代表当前模块是否开启了命名空间，Module 实例读取 namespaced 属性会触发 get 方法，根据模块的配置对象的 namespaced 属性值返回真假。

### installModule

讲完模块对象的创建和模块的收集，接着就是模块的安装，即这句：

```js
installModule(this, state, [], this._modules.root)
```
这是安装根模块，做了几件事：
1. 往 store._modulesNamespaceMap 对象中存入命名空间和对应的 module
2. 给模块的 state 添加子 state
3. 注册用户配置的 mutation getter 和 action
4. 递归安装子模块

```js
function installModule(store, rootState, path, module, hot) {
  const isRoot = !path.length 
  const namespace = store._modules.getNamespace(path) 
  // ...
}
```

installModule 函数接收什么参数：

- store：new Vuex.Store 时传入的 store 对象。
- rootState：根 state 对象
- path：当前的模块的路径数组
- module：当前模块对象
- hot：是否支持热重载（这里不讨论它）

installModule 代码较长，我们分段来看：

```js
const isRoot = !path.length
const namespace = store._modules.getNamespace(path)
```

变量 isRoot 的真假代表当前模块是否为根模块。接着，调用 getNamespace 根据当前模块的 path 获取当前模块的命名空间。我们看看 getNamespace：

```js
getNamespace (path) {
  let module = this.root
  return path.reduce((namespace, key) => {
    module = module.getChild(key)
    return namespace + (module.namespaced ? key + '/' : '')
  }, '')
}
```
首先获取根模块对象，然后 path.reduce 调用，累加器初始值为''，每次迭代返回的字符串覆盖给 namespace，凡是模块开启了命名空间，就将当前命名空间字符串拼上当前的模块名和'/'，否则拼接''。

迭代结束，namespace 获取到当前模块的命名空间字符串。

继续看 installModule：

```js
if (module.namespaced) {
  if (store._modulesNamespaceMap[namespace] && process.env.NODE_ENV !== 'production') {
    console.error(`[vuex] duplicate namespace ${namespace} for the namespaced module ${path.join('/')}`)
  }
  store._modulesNamespaceMap[namespace] = module
}
```
store._modulesNamespaceMap 对象存放各个开启了命名空间的模块的命名空间字符串，如果当前模块的命名空间字符串已经存在于该对象，则警告提示：重复的命名空间名。如果不存在，则将命名空间和对应的 module 对象，添加进来。

继续看 installModule 的代码：

```js
if (!isRoot && !hot) {
  const parentState = getNestedState(rootState, path.slice(0, -1))
  const moduleName = path[path.length - 1]
  store._withCommit(() => {
    if (process.env.NODE_ENV !== 'production') {
      if (moduleName in parentState) {
        console.warn(
          `[vuex] state field "${moduleName}" was overridden by a module with the same name at "${path.join('.')}"`
        )
      }
    }
    Vue.set(parentState, moduleName, module.state)
  })
}
```
如果当前模块不是根模块，且非热更新，执行 if 语句块：调用 getNestedState 获取当前模块的父模块的 state。

```js
function getNestedState (state, path) {
  return path.reduce((state, key) => state[key], state)
}
```

父模块的 path 调用 reduce，累加器的初始值为根 state，每次迭代返回出它的子模块的 state，沿着 path 路径，一个个获取子 state，直到获取到当前 state 的父 state。就比如`store.state` >> `store.state.a` >> `store.state.a.b`...

`const moduleName = path[path.length - 1]` 获取到当前模块的模块名

接着调用 store._withCommit，传入回调函数：

```js
store._withCommit(() => {
  if (process.env.NODE_ENV !== 'production') {
    if (moduleName in parentState) {
      console.warn(
        `[vuex] state field "${moduleName}" was overridden by a module with the same name at "${path.join('.')}"`
      )
    }
  }
  Vue.set(parentState, moduleName, module.state)
})
```

回调函数中：开发环境下，假设当前模块名叫 'value'，如果它的父模块 foo 的 state 对象中也有 'value'，当你通过 store.state.foo.value 获取父模块 foo 的 state 的 value 值时，你拿到的却是当前 value 模块的配置对象。父模块的 state 的 value 属性被屏蔽了。

因此，如果模块名已存在于父模块的 state 对象中，会给出报错提示。接着：

`Vue.set(parentState, moduleName, module.state)`

Vue.set 给父模块的 state 对象添加响应式属性，属性名为当前模块名，属性值为模块的 state 对象。于是，读取父模块的 state 对象中的当前模块名，就获得当前模块的 state 值。并且这些 state 属性是响应式的。

所以根 state 对象会添加它的子 state 属性，如果子模块还嵌套子模块，installModule 时会把当前模块的 state 添加到父 state 中。

我们回头看看 _withCommit 这个 Store 的原型方法

```js
_withCommit (fn) {
  const committing = this._committing
  this._committing = true
  fn()
  this._committing = committing
}
```
_withCommit 接收函数 fn，把 store._committing 置为 true，然后执行 fn，再把 store._committing 恢复为原值，保证了 fn 执行过程中 store._committing 始终为 true。

为什么要这么做？Vuex 把所有对 state 的修改操作都放到 _withCommit 的回调 fn 中，保证这个过程中 store._committing 为 true，其他时候都为 false。当用户在 mutation 之外修改 state，就便于报错提示。

接下来，生成一个包含本地化的方法和属性的，类似 store 对象那样的对象 local：

```js
const local = module.context = makeLocalContext(store, namespace, path)
```

执行 makeLocalContext 方法，传入 store 对象，当前模块的命名空间，当前 path，返回值赋给 local 和 module.context。

```js
function makeLocalContext (store, namespace, path) {
  const noNamespace = namespace === ''
  const local = {
    // dispatch:....
    // commit:....
  }
  Object.defineProperties(local, {
    getters: {
      // ...
    },
    state: {
      // ...
    }
  })
  return local
}
```

noNamespace 的真假，代表该模块是否开启了命名空间。然后创建对象 local，里面定义 dispatch、commit 方法和 getters 和 state 属性，最后返回出 local 对象。

我们先看 local.dispatch：

```js
const local = {
  dispatch: noNamespace ? store.dispatch : (_type, _payload, _options) => {
    const args = unifyObjectStyle(_type, _payload, _options)
    const { payload, options } = args
    let { type } = args
    if (!options || !options.root) {
      type = namespace + type
      if (process.env.NODE_ENV !== 'production' && !store._actions[type]) {
        console.error(`[vuex] unknown local action type: ${args.type}, global type: ${type}`)
        return
      }
    }
    return store.dispatch(type, payload)
  },
}
```

如果当前模块没有开启命名空间，则 local.dispatch 就取 store.dispatch。后面会仔细讲 store.dispatch。

如果当前模块开启了命名空间，则重新定义 local.dispatch 方法，它可以接收三个参数：
1. _type：即 action 的名称
2. _payload：载荷对象
3. _options：配置对象

参数先传入 unifyObjectStyle 函数做归一化处理，返回值赋给 args：

```js
function unifyObjectStyle (type, payload, options) {
  if (isObject(type) && type.type) {
    options = payload
    payload = type
    type = type.type
  }
  if (process.env.NODE_ENV !== 'production') {
    assert(typeof type === 'string', `expects string as the type, but found ${typeof type}.`)
  }
  return { type, payload, options }
}
```

如果第一个参数传的是对象且有 type 属性，则把传入的第二个参数作为 options，第一个参数作为 payload，type 取第一个参数的 type 属性。如果 type 不是字符串，抛出错误。

最后返回出包含 type, payload, options 的对象，再从中解构出 type, payload, options 变量。

```js
dispatch: noNamespace ? store.dispatch : (_type, _payload, _options) => {  
  const args = unifyObjectStyle(_type, _payload, _options)
  const { payload, options } = args
  let { type } = args
  if (!options || !options.root) {
    type = namespace + type
    if (process.env.NODE_ENV !== 'production' && !store._actions[type]) {
      console.error(`[vuex] unknown local action type: ${args.type}, global type: ${type}`)
      return
    }
  }
  return store.dispatch(type, payload)
},
```

如果 local.dispatch 没有接收到配置对象或配置对象没传 root:true，则 type 要加上命名空间字符串作为前缀。如果接收的配置对象中传了 root:true，则 type 不做变动。

如果 store._actions 这个存放已注册的 action 方法的对象中，没有 type 对应的值，说明当前 dispatch 的 action 还没注册，报错提示并直接返回。

最后调用 store.dispatch，传入的 type 是考虑了命名空间的 type。这意味着，local.dispatch 接收到的本地 type 会在函数中转成全局 type，即考虑了命名空间，传入 store.dispatch 执行。

接着看 local.commit。如果当前模块没有开启命名空间，则 local.commit 就是 store.commit，否则重新定义 local.commit：

```js
commit: noNamespace ? store.commit : (_type, _payload, _options) => {
  const args = unifyObjectStyle(_type, _payload, _options)
  const { payload, options } = args
  let { type } = args
  if (!options || !options.root) {
    type = namespace + type
    if (process.env.NODE_ENV !== 'production' && !store._mutations[type]) {
      console.error(`[vuex] unknown local mutation type: ${args.type}, global type: ${type}`)
      return
    }
  }
  store.commit(type, payload, options)
}
```

接收 mutation type、载荷对象、配置对象，传入 unifyObjectStyle 做归一化处理。再从返回值中解构出 type, payload, options 变量。

如果 local.commit 没有接收到配置对象或配置对象没传 root:true，则 type 字符串要加上命名空间字符串作为前缀，否则 type 不做改动。

如果 store._mutations 这个存放已注册的 mutation 方法的对象里，不存在 type 对应的值，报错提示，告诉用户提交的 mutation 不存在，直接返回。

最后调用并返回 store.commit，传入的是考虑了命名空间的 type。这意味着，local.commit 接收到的本地 type 会在函数中转成全局 type，即考虑了命名空间，转而调用 store.commit

```js
Object.defineProperties(local, {
  getters: {
    get: noNamespace
      ? () => store.getters
      : () => makeLocalGetters(store, namespace)
  },
  state: {
    get: () => getNestedState(store.state, path)
  }
})
return local
```

继续给 local 对象添加两个只读的响应式属性：getters 和 state。

读取 local.getters 时，如果当前模块没有开启命名空间，则直接返回 store.getters。如果开启了命名空间，返回 makeLocalGetters 的执行结果，传入的是 store 对象和当前的命名空间。读取 local.state 时，返回当前模块的 state 对象。

看看 makeLocalGetters 函数是如何生成本地 getters 的：

```js
function makeLocalGetters (store, namespace) {
  if (!store._makeLocalGettersCache[namespace]) {
    const gettersProxy = {}
    const splitPos = namespace.length
    Object.keys(store.getters).forEach(type => {
      if (type.slice(0, splitPos) !== namespace) return
      const localType = type.slice(splitPos)
      Object.defineProperty(gettersProxy, localType, {
        get: () => store.getters[type],
        enumerable: true
      })
    })
    store._makeLocalGettersCache[namespace] = gettersProxy
  }
  return store._makeLocalGettersCache[namespace]
}
```
store._makeLocalGettersCache 对象专门缓存模块的命名空间和对应的 getters。

如果该缓存对象已经存在当前命名空间，则直接返回其缓存值，否则，执行if语句块：定义一个空对象 gettersProxy，遍历 store.getters 对象，当前遍历的 type 从开头截取一个命名空间字符串的长度，如果得到的字符串和命名空间字符串不相同，直接返回，继续遍历。

遇到相同的，则获取去掉命名空间前缀的本地 getter 名，将它作为只读属性添加到 gettersProxy 对象中，属性值是 store.getters 中对应的全局 getter。

遍历结束后，gettersProxy 对象就存放了该开启了命名空间的模块下的所有本地 getter。

然后将 gettersProxy 赋给 store._makeLocalGettersCache[namespace]。因此 _makeLocalGettersCache 对象中，一个命名空间对应一个对象，存放该模块下的 getter。

可见，makeLocalGetters 就是根据命名空间在全局 getters 对象中找出当前命名空间对应的模块的所有的 getter，返回一个键是本地 getter 名，值是对应的 getter 的对象。

到此 local 对象填充完毕，里面是为当前模块设置的 dispatch、commit 方法，和 getter 和 state 属性。

回到 installModule 函数，接着是对用户配置的 mutation 进行注册，调用 Module 的原型方法 forEachMutation，将回调函数传入执行

```js
module.forEachMutation((mutation, key) => {
  var namespacedType = namespace + key;
  registerMutation(store, namespacedType, mutation, local);
})
```
```js
forEachMutation (fn) {
  if (this._rawModule.mutations) {
    forEachValue(this._rawModule.mutations, fn)
  }
}
```
如果当前模块的配置对象传了 mutations，遍历该 mutations 对象执行回调。回调首先将 type 名加上当前模块的命名空间作为前缀。然后调用 registerMutation 注册，可见注册 mutation 用的是全局 type。

```js
function registerMutation (store, type, handler, local) {
  const entry = store._mutations[type] || (store._mutations[type] = [])
  entry.push(function wrappedMutationHandler (payload) {
    handler.call(store, local.state, payload)
  })
}
```
结合`registerMutation(store, namespacedType, mutation, local);`来看

registerMutation 函数接收的这 4 个参数：

1. store：new Vuex.Store 创建的 store 实例
2. namespacedType：结合了命名空间字符串的全局 mutation 名
3. mutation：对应的处理函数。
4. local：local 对象

```js
function registerMutation (store, type, handler, local) {
  const entry = store._mutations[type] || (store._mutations[type] = [])
  entry.push(function wrappedMutationHandler (payload) {
    handler.call(store, local.state, payload)
  })
}
```

如果当前遍历的全局 mutation 名在 store._mutations 对象中没有对应的值，则将它添加进去，初始化为空数组，用来存放对应的用户配置的 handler。

接着往数组里推入 handler 的封装函数，handler 执行时的 this 指向 store，且传入 handler 的是 local.state。用户在书写 handler 时可以通过 this 引用到 store，通过局部的 state 名能获取到当前模块的 state 值。

遍历完当前模块的 mutations 对象后，store._mutations 对象中，每一个全局 mutation 名，对应一个存放了包裹后的 mutation 处理函数的数组。这就是 mutation 的注册。

接着是 action 的注册：

```js
module.forEachAction((action, key) => {
  const type = action.root ? key : namespace + key
  const handler = action.handler || action
  registerAction(store, type, handler, local)
})
```
```js
forEachAction (fn) {
  if (this._rawModule.actions) {
    forEachValue(this._rawModule.actions, fn)
  }
}
```
如果当前模块的配置对象传了 actions，则遍历 actions 对象执行回调：如果用户配置 action 时没有传 root: true，则 type 为本地的 action 名，如果配置了root: true，则 type 为命名空间字符串加上本地 action 名。

用户配置 action 时，可以传一个包含 handler 的对象，也可以直接传 handler 函数。

调用 registerAction 进行 action 的注册。

```js
function registerAction (store, type, handler, local) {
  const entry = store._actions[type] || (store._actions[type] = [])
  entry.push(function wrappedActionHandler (payload) {
    let res = handler.call(store, {
      dispatch: local.dispatch,
      commit: local.commit,
      getters: local.getters,
      state: local.state,
      rootGetters: store.getters,
      rootState: store.state
    }, payload)
    if (!isPromise(res)) {
      res = Promise.resolve(res)
    }
    if (store._devtoolHook) {
      // ...
    } else {
      return res
    }
  })
}
```
store._actions 对象存放 action 名和对应的数组，如果该缓存对象中当前 action 名没有对应的值，则初始化为[]。然后向该数组中推入用户传的 handler 的包装函数。

包装函数执行，首先执行 handler，返回值赋给 res，执行时的 this 指向 store 对象，handler 接收一个和 store 实例具有相同方法的 context 对象，但 context 的 state getters commit dispatch 是局部化的属性和方法。比如，调用 context.commit 提交模块中的 mutation 时，传入本地 type 即可，即便该模块开启了命名空间。

如果返回值 res 不是 promise 实例，则将它包裹为成功值为 res 的 promise 实例，即经过注册后的 action 函数执行必返回 promise。

接着，对用户配置的 getter 进行注册

```js
module.forEachGetter((getter, key) => {
  const namespacedType = namespace + key
  registerGetter(store, namespacedType, getter, local)
})

forEachGetter (fn) {
  if (this._rawModule.getters) {
    forEachValue(this._rawModule.getters, fn)
  }
}
```
遍历用户给当前模块的配置对象传的 getters 对象，执行回调，在回调中，获取当前模块的命名空间和 getter 名拼接后的字符串，然后调用 registerGetter 注册 getter。

这么看来注册 getter 和 mutation 都是用的全局 type。注册 action，如果没有配置 root:true，也是使用全局 type，否则使用局部的 type。

```js
function registerGetter (store, type, rawGetter, local) {
  if (store._wrappedGetters[type]) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[vuex] duplicate getter key: ${type}`)
    }
    return
  }
  store._wrappedGetters[type] = function wrappedGetter (store) {
    return rawGetter(local.state,local.getters,store.state,store.getters)
  }
}
```
注册 getter，如果当前全局 getter 名已经存在于 store._wrappedGetters 对象中，则报错提示：重复的 getter 名字。然后直接返回。如果不是，则往该对象中添加全局 getter 名和对应的封装后的 getter 函数。

用户配置的 rawGetter 函数执行传入的是 local.state, local.getters 和 store.state, store.getters。local.state 是当前模块下的 state。用户书写 getter 函数时，第一个参数拿到的是模块的局部 state。

到此 mutation action getter 注册完毕，来到了 installModule 的最后一步：

```js
module.forEachChild((child, key) => {
  installModule(store, rootState, path.concat(key), child, hot)
})
forEachChild (fn) {
  forEachValue(this._children, fn)
}
```

遍历当前模块的 _children 数组中所有的子模块对象，递归调用 installModule，传入：store 对象，根state，子模块的 path，子模块对象和 hot。子模块的 mutation、action、getter 也得到注册。


## Store原型方法commit和dispatch
### commit

更改 state 只能通过提交 mutation，mutation 和事件类似：每个 mutation 都有一个事件类型 type 和回调函数 handler，handler 是用户书写的，它接收 local.state 作为第一个参数。

commit 是 Store 的原型方法：

```js
commit (_type, _payload, _options) {
  const {type, payload, options} = unifyObjectStyle(_type, _payload, _options)
  const mutation = { type, payload }
  const entry = this._mutations[type]
  if (!entry) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[vuex] unknown mutation type: ${type}`)
    }
    return
  }
  this._withCommit(() => {
    entry.forEach(function commitIterator (handler) {
      handler(payload)
    })
  })
  // ...
}
```
commit 可以接收 3 个参数：

1. _type：要提交的 mutation 的 type 字符串
2. _payload：载荷对象
3. _options：配置对象，比如可以传 root: true，它允许在命名空间模块里提交根的 mutation

我们分段来看看 commit 的代码：

```js
const {type, payload, options} = unifyObjectStyle(_type, _payload, _options)
const mutation = { type, payload }
```

unifyObjectStyle 函数对参数做统一化处理。再解构出 type, payload, options 变量。

```js
const entry = this._mutations[type]
if (!entry) {
  if (process.env.NODE_ENV !== 'production') {
    console.error(`[vuex] unknown mutation type: ${type}`)
  }
  return
}
```
接着获取 store._mutations 对象中的 type 对应的数组，它存放该 type 对应的 mutation 处理函数。如果该数组不存在，说明该 mutation 没有注册过，无法提交该 mutation，在开发环境下打印警告，并直接返回。

接下来，继续看：

```js
this._withCommit(() => {
  entry.forEach(function commitIterator (handler) {
    handler(payload)
  })
})
```

遍历 store._mutations[type] 数组，执行数组里的 handler，传入用户调用 commit 时传入的 payload。因为 handler 执行是在修改 state，所以 _withCommit 的包裹保证 store._committing 为 true。

接下来:
```js
this._subscribers
    .slice()
    .forEach(sub => sub(mutation, this.state))
```
store._subscribers 数组存放的是订阅 mutation 的函数，commit 提交 mutation 时，将数组中所有的订阅函数逐个执行，传入{ type, payload }和根state。通过 store.subscribe 方法注册订阅 mutation 的函数，用于追踪 state 的变化。

mutation 中必须是同步操作，全部 state 的改变都用同步实现。状态改变后，订阅函数执行，马上就追踪到一个新的状态。如果 mutation 中异步改变状态，订阅函数执行时，异步操作还没执行，状态的改变变得不可追踪。

### dispatch

dispatch 也是 Store 的原型方法，作用是分发 action。action 类似于 mutation，不同的是 action 不可以直接更改状态，但可以提交 mutation，且可以包含异步操作。

dispatch 的代码比较长，分段看：

```js
dispatch (_type, _payload) {
  const {type, payload } = unifyObjectStyle(_type, _payload)
  const action = { type, payload }
  const entry = this._actions[type]
  if (!entry) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[vuex] unknown action type: ${type}`)
    }
    return
  }
  // ....
}
```
unifyObjectStyle 先做参数做归一化。归一化后的 type, payload 放入一个对象 action

store._actions[type] 是存放 type 对应的 action 方法的数组。如果该数组不存在，说明该 type 的 action 还没注册，报警提示，然后直接返回。

继续看 dispatch：

```js
try {
  this._actionSubscribers
    .slice()
    .filter(sub => sub.before)
    .forEach(sub => sub.before(action, this.state))
} catch (e) {
  if (process.env.NODE_ENV !== 'production') {
    console.warn(`[vuex] error in before action subscribers: `)
    console.error(e)
  }
}
```
遍历 store._actionSubscribers 数组，过滤出存在 before 方法的项，再将所有 before 方法遍历执行。try catch 语句捕获这个过程中的错误。

再接下来：

```js
const result = entry.length > 1
  ? Promise.all(entry.map(handler => handler(payload)))
  : entry[0](payload)
return result.then(res => {
  // ...
  return res
})
```
如果 action type 对应的 handler 有多个，可能每个都用 promise 管控了异步操作。如果只是遍历执行这些处理函数：entry.map(handler => handler(payload))，返回的数组赋给 result，由于这是同步代码，所以 result 数组里的 promise 的状态都是等待态，等异步有了结果，result 数组里的单个 promise 才会改变状态。

而 `Promise.all(entry.map(handler => handler(payload)))` 返回一个 promise 实例，map 返回的数组里所有 promise 都成功或数组里不包含 promise 时，这个 promise 才会成功，如果其中有一个失败了，则该 promise 失败。

Promise.all 返回的 promise 实例赋给 result，起初是 pending 状态，等所有 promise 都有结果了，则 result 也有结果了。

如果 action type 的 handler 只有一个，则执行它，传入 payload，返回值赋给 result。

经过注册后的 action handler 被包裹成一个必定返回 promise 的函数，所以 entry[0](payload) 必返回 promise 实例。因此 result 必定是 promise 实例。

```js
return result.then(res => {
  try {
    this._actionSubscribers
      .filter(sub => sub.after)
      .forEach(sub => sub.after(action, this.state))
  } catch (e) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[vuex] error in after action subscribers: `)
      console.error(e)
    }
  }
  return res
})
```

异步有了结果，promise 成功的话，执行 then 的成功回调，在成功回调中，遍历 store._actionSubscribers 数组，过滤出带有 after 方法的项，遍历执行所有 after 方法，最后返回出 res。

store.dispatch 最后返回 then 返回的 promise。用户可以用它继续 then，并在成功回调中拿到 res。

```js
store.dispatch('actionA').then((res) => {
  // ....
})
```
res 是 actionA 函数返回的 promise 里的成功值，如果 handler 有多个，则它是数组。如果只有一个，则它是单个值。

## resetStoreVM

现在来到实例化 Store 构造函数的核心三件事的最后一件：响应式化 state

```js
resetStoreVM(this, state)
```
为什么要响应变化，因为在各个 Vue 实例里用到 store 的 state 的话，希望每当状态发生变化时，相应的组件会得到更新

传入 resetStoreVM 的 this 是 store 对象，state 是根 state，我们看看 resetStoreVM：

```js
function resetStoreVM (store, state, hot) {
  const oldVm = store._vm
  store.getters = {}
  store._makeLocalGettersCache = Object.create(null)
  const wrappedGetters = store._wrappedGetters
  const computed = {}
  forEachValue(wrappedGetters, (fn, key) => {
    computed[key] = partial(fn, store)
    Object.defineProperty(store.getters, key, {
      get: () => store._vm[key],
      enumerable: true
    })
  })
  // ...
}
```

首先将 store._vm 赋给 oldVm，缓存一下旧的 vm 实例。然后给 store 对象上添加 getters 和 _makeLocalGettersCache 属性，值均为一个空对象，也可以看成重置。

store._wrappedGetters 对象存放已注册的 getter 方法。再定义一个 computed 空对象。遍历 store._wrappedGetters，往 computed 对象添加同名方法，方法值为 partial(fn, store)。

```js
function partial (fn, arg) {
  return () => {
    return fn(arg)
  }
}
```

传入 partial 的是已注册的 getter 方法和 store 对象，返回一个新的函数，新函数实际执行 getter 方法，getter 执行接收 store 对象。

为什么不直接给 computed 对象添加 getter。因为为了形成闭包，getter 在外部调用时，也能引用 partial 函数作用域中的 store 这个私有形参，而 partial 的 store 也通过闭包引用了 resetStoreVM 的私有形参 store，所以 store 不会随着 resetStoreVM 函数执行结束而销毁，继续驻留在内存中了，getter 方法中始终能引用到 store 对象。

接着往 store.getters 这个空对象添加只读属性，属性名是 getter 名，读取返回 store._vm[key]

```js
Object.defineProperty(store.getters, key, {
  get: () => store._vm[key],
  enumerable: true
})
```

问题来了，store._vm 是怎么来的，上面怎么会有 getter 的同名属性？接着看 resetStoreVM 函数：

```js
const silent = Vue.config.silent
Vue.config.silent = true
store._vm = new Vue({
  data: {
    $$state: state
  },
  computed
})
Vue.config.silent = silent
```
首先缓存 Vue.config.silent 的值。然后将 Vue.config.silent 置为 true，new Vue 后将它恢复为原来的值，保证了这期间 Vue 不会打印日志与警告。因为借用 Vue 创建实例的过程可能会存在一些不严格的模式，但不希望因此报错。

$$state 会转成响应式属性，属性值：根 state 会被深度观测，内部嵌套的子 state 也响应式化。

Store 构造函数还有一个 state 原型属性：
，
```js
get state () {
  return this._vm._data.$$state
}
set state (v) {
  if (process.env.NODE_ENV !== 'production') {
    assert(false, `use store.replaceState() to explicit replace store state.`)
  }
}
```
我们知道，安装了 Vuex 后，之后创建的所有 vm 实例能引用到 store 对象。因此读取 vm.$store.state 返回的是 store._vm._data.$$state

我们知道，Vue 把 data 数据挂载到 vm 实例的 _data 上，所以 store._vm._data 访问到的是定义的 data 对象，store._vm._data.$$state 访问的是 data 中的 $$state，即根state。

因此在组件中 vm.$store.state 就能访问到根 state，并且 state 内部的属性是响应式的。

注意：直接设置 store.state 会抛出错误：请使用 replaceState API 进行 state 的替换。

```js
store._vm = new Vue({
  // ...
  computed
})
```
computed 对象作为 computed 选项传入 new Vue，里面存放的 getter 方法被注册为计算属性。这样 store._vm 就代理了 getters，访问 getters 就是访问计算属性。

由前面可知，假如有个 getter 名叫 xxx，resetStoreVM 函数会向 store.getters 对象添加了响应式只读属性 xxx，返回 store._vm.xxx。

因此在组件中访问 vm.$store.getters.xxx，会返回 store._vm.xxx，xxx 已经被注册为 store._vm 的计算属性了，通过 store._vm.xxx 访问到 xxx 的值。

继续看 resetStoreVM：

```js
if (store.strict) {
  enableStrictMode(store)
}
```
如果用户开启严格模式，调用 enableStrictMode 函数，传入 store

```js
function enableStrictMode (store) {
  store._vm.$watch(function () { return this._data.$$state }, () => {
    if (process.env.NODE_ENV !== 'production') {
      assert(store._committing, `do not mutate vuex store state outside mutation handlers.`)
    }
  }, { deep: true, sync: true })
}
```
由 Vue 源码可知，$watch 执行，会执行一次 `function () { return this._data.$$state }` 函数，通过读取数据属性，收集创建出来的 watcher，watcher 监听了 `$$state` 这个属性，配置对象是 `{ deep: true, sync: true }`，意味着它的属性值(根state)会被深度观测，当 state 发生变化时，watcher 的 update 方法执行，会重新求值，并执行 $watch 的回调函数。

在该回调函数中，如果当前 store._committing 为 false，则会抛错。因为 mutation 执行期间之外 _committing 都是 false，严格模式下，state 在 mutation 之外被修改是不允许的。所以 enableStrictMode 函数为 state 创建了一个监听，它被修改时执行回调，警告用户。

接着看 resetStoreVM 的最后一部分：

```js
if (oldVm) {
  if (hot) {
    store._withCommit(() => {
      oldVm._data.$$state = null
    })
  }
  Vue.nextTick(() => oldVm.$destroy())
}
```
如果存在之前创建的旧的 Vue 实例，现在 resetStoreVM 要重新创建的 vm 和 watcher，要销毁旧的 vm 实例，但不希望在同步代码中销毁，会阻塞代码的执行，所以调用 nextTick 方法将销毁的操作放到异步。销毁 vm 实例意味着会将它上面的 watcher 销毁，不再监听 state。

resetStoreVM 函数就看完了。

## 辅助函数的实现

### mapState

在组件中可以通过 this.$store.state.xxx 使用 state 数据 xxx，但书写有点麻烦，为了简便，可以将 xxx 声明为当前组件的计算属性。当组件需要使用到多个 state，逐一声明也很麻烦。这时就需要 mapState 辅助函数：
```js
const mapState = normalizeNamespace((namespace, states) => {
  var res = {};
  if (process.env.NODE_ENV !== 'production' && !isValidMap(states)) {
    console.error('[vuex] mapState: mapper parameter must be either an Array or an Object')
  }
  normalizeMap(states).forEach(function (ref) {
    // ...
  });
  return res
});
```

mapState 是 normalizeNamespace 函数的返回值，看看 normalizeNamespace 函数：

```js
function normalizeNamespace (fn) {
  return (namespace, map) => {
    if (typeof namespace !== 'string') {
      map = namespace
      namespace = ''
    } else if (namespace.charAt(namespace.length - 1) !== '/') {
      namespace += '/'
    }
    return fn(namespace, map)
  }
}
```
normalizeNamespace 接收函数 fn，返回新的函数，因此 mapState 指向该新函数。如果用户调用 mapState 时传的第一个参数不是字符串，就把它赋给 map，namespace 赋为 ''。如果传的第一个参数是字符串，但不是以"/"结尾，则给它的末尾加上"/"。

处理后的 namespace 和 map 传入 fn 执行，mapState 函数返回 fn 的执行结果。

```js
const mapState = normalizeNamespace((namespace, states) => {
  var res = {};
  if (process.env.NODE_ENV !== 'production' && !isValidMap(states)) {
    console.error('[vuex] mapState: mapper parameter must be either an Array or an Object')
  }
  normalizeMap(states).forEach(({ key, val }) => {
    // ...
  });
  return res
});
```

fn 执行，首先会创建空对象 res，如果接收的 states 不是数组或纯对象，开发环境下会给出报错提示，最后返回 res 对象，中间的过程就是填充 res 对象。因此 mapState 函数返回 res 对象。

仔细看回调 fn，normalizeMap(states) 返回了什么？

```js
function normalizeMap (map) {
  if (!isValidMap(map)) return []
  return Array.isArray(map)
    ? map.map(key => ({ key, val: key }))
    : Object.keys(map).map(key => ({ key, val: map[key] }))
}
```
normalizeMap(states) 的 states 是用户调用 mapState 时传入的数组或对象，如果它为数组，比如 mapState(['price', 'amount'])，则将数组的每项 key 转成 { key: key, val: key }。

```js
mapState({
  a: state => state.some.nested.module.a,
  b: state => state.some.nested.module.b
})
```

如果 states 传的是类似上面这样的对象，normalizeMap 会获取对象中的所有属性组成的数组，将数组的每项 key 转成 { key: key, val: map[key] }

可见 normalizeMap 函数将调用 mapState 时传入的 map 归一化为一个由对象组成的数组。然后对它进行遍历：

```js
normalizeMap(states).forEach(({ key, val }) => {
  res[key] = function mappedState () {
    let state = this.$store.state
    let getters = this.$store.getters
    if (namespace) {
      const module = getModuleByNamespace(this.$store, 'mapState', namespace)
      if (!module) return
      state = module.context.state
      getters = module.context.getters
    }
    return typeof val === 'function'
      ? val.call(this, state, getters)
      : state[val]
  }
  res[key].vuex = true
})
```

forEach 的回调中，key 拿到当前遍历对象中的 key 值，val 拿到对象中的 val 值。然后给 res 对象添加方法，方法名为 key，方法为 mappedState 函数。

mappedState 函数首先获取到全局 state 和 getters 赋给 state 和 getters。如果用户调用 mapState 传了 namespace 字符串，即 namespace 存在，则调用获取命名空间对应的 module 对象。如果用户调用 mapState 时没传 namespace，则 namespace 此时为 ''，不会执行 if 语句块。

```js
function getModuleByNamespace (store, helper, namespace) {
  const module = store._modulesNamespaceMap[namespace]
  if (process.env.NODE_ENV !== 'production' && !module) {
    console.error(`[vuex] module namespace not found in ${helper}(): ${namespace}`)
  }
  return module
}
```

经过 installModule 之后，所有命名空间和对应的模块对象已经缓存到 store._modulesNamespaceMap。在里面可以找到并返回命名空间对应的 module。

```js
normalizeMap(states).forEach(({ key, val }) => {
  res[key] = function mappedState () {
    let state = this.$store.state
    let getters = this.$store.getters
    if (namespace) {
      const module = getModuleByNamespace(this.$store, 'mapState', namespace)
      if (!module) return
      state = module.context.state
      getters = module.context.getters
    }
    return typeof val === 'function'
      ? val.call(this, state, getters)
      : state[val]
  }
  res[key].vuex = true
})
```
如果用户 mapstate 传的命名空间没有写对，没有获取到对应的 module，则 mappedState 就直接返回。如果获取到了，则把当前模块的 state 和 getters 覆盖给 state 和 getters，说明如果用户 mapstate 时传了命名空间，会尝试找到它对应的模块，因为用户希望获取的是本地模块的 state。

mappedState 函数会根据 val 是否是函数，返回 val.call(this, state, getters) 或 state[val]

val 是 normalizeMap(states) 数组中当前遍历对象的 val 值，如果它是函数，说明用户调用 mapState 传的是包含函数的对象，则直接调用 val，执行时 this 指向当前 Vue 实例，因为 mapState 调用的环境中，this 指向当前 Vue 实例。val 执行传入 state，getters，说明用户书写 val 函数可以接收到 state 和 getters，至于是本地的还是全局的 state 和 getters，取决于用户 mapState 时是否传了命名空间字符串。

如果 val 不是函数，则它是用户传入的 state 名称字符串，则返回 state 对象中 val 对应的 state 值，至于是本地的还是全局的 state，取决于用户 mapState 时是否传了命名空间字符串。

综上可知：mapState 函数的第一个参数可以选传具体模块的命名空间字符串，第二个参数可以传由 state 名组成的数组，也可以传一个对象，属性名是自定义属性名，属性值可以是函数，也可以是 state 名字符串。

mapState 最后返回 res 对象，里面存放的属性名可能是 state 名，也可能是用户自定义的别名，属性值是 mappedState 函数，它执行返回 state 对象中对应 state 值，或是 val 函数的执行返回值

因此，你可以这么使用mapState：

```js
computed: mapState({
  count: state => state.count,
  countAlias: 'count',  
  countPlus (state) { // 没有用箭头函数，因为this要指向当前组件实例
    return state.count + this.localCount
  }
})
```
传入 mapState 的就是 map 对象，经过 normalizeMap 的处理，转成由对象{ key, val }组成的数组，遍历数组，往 res 对象里添加方法，方法名为 key，方法执行会根据 val 是否为函数，返回 val 的执行结果或 state 中 val 的值。

用户给 mapState 传入的 map 可以是数组，比如：

```js
computed: mapState([
  'count', // 映射 this.count 为 store.state.count
  'xxxxx'
])
```
传入的数组的每项转成类似 {'count': 'count'}，遍历数组，往 res 对象添加方法，方法名为 'count'，方法本身执行返回全局 state 中的 count。

mapState 返回的 res 对象，用户可以利用对象展开运算符，将里面的方法直接混入到 computed 的选项对象中，不会影响用户定义别的计算属性：

```js
computed: {
  localComputed () { /* ... */ },
  ...mapState({
    // ...
  })
}
```

带命名空间的模块里的 state 怎么通过 mapState 获取？可以这么写

```js
computed: {
  ...mapState({
    a: state => state.some.nested.module.a,
    b: state => state.some.nested.module.b
  })
},
```
"a"、"b" 是用户起的计算属性名，属性值是返回嵌套模块中的 state 数据的函数，这样就能获取本地模块的 state，但这么写明显比较繁琐。用户可以在 mapState 的第一个参数传模块的命名空间，这样所有的绑定会自动将该模块作为上下文。

```js
computed: {
  ...mapState('some/nested/module', {
    a: state => state.a,
    b: state => state.b
  })
},
```
前面说过，mapState 会根据命名空间获取对应的模块，传入 map 对象中的函数中的 state 拿到的不是全局 state，而是对应模块的本地 state，其余逻辑不变。

到此 mapState 的内部实现就讲完了。

### mapGetters

和 mapState 的实现很像，就不分段讲了。

```js
const mapGetters = normalizeNamespace((namespace, getters) => {
  const res = {}
  if (process.env.NODE_ENV !== 'production' && !isValidMap(getters)) {
    console.error('[vuex] mapGetters: mapper parameter must be either an Array or an Object')
  }
  normalizeMap(getters).forEach(({ key, val }) => {
    val = namespace + val
    res[key] = function mappedGetter () {
      if (namespace && !getModuleByNamespace(this.$store, 'mapGetters', namespace)) {
        return
      }
      if (process.env.NODE_ENV !== 'production' && !(val in this.$store.getters)) {
        console.error(`[vuex] unknown getter: ${val}`)
        return
      }
      return this.$store.getters[val]
    }
    res[key].vuex = true
  })
  return res
})
```
mapGetters 接收 namespace（可选）和 getters（一个 map 对象），mapGetters 指向 normalizeNamespace 执行返回的函数，mapGetters 执行，实际执行传入 normalizeNamespace 的回调函数。

用户传的 map 对象有两种形式：1、['getter1', 'getter2']，每项是 getter 名。2、{ myGetter1: 'getter1' } myGetter1 是用户起的别名，getter1 是 getter 名。

回调函数中，首先定义空对象 res，将传入的 map 对象经过 normalizeMap 处理成数组，对应上面的例子分别是：1. [{'getter1': 'getter1'}, {'getter2': 'getter2'}] 2. [{'myGetter1': 'getter1'}]

接着遍历数组，key 拿到当前遍历对象里的 key，val 拿到它的 val，如果 mapGetters 时传了命名空间，则 val 字符串要加上命名空间作为前缀，val 就是考虑了命名空间的 getter 名。

```js
res[key] = function mappedGetter () {
  if (namespace && !getModuleByNamespace(this.$store, 'mapGetters', namespace)) return
  if (process.env.NODE_ENV !== 'production' && !(val in this.$store.getters)) {
    console.error(`[vuex] unknown getter: ${val}`)
    return
  }
  return this.$store.getters[val]
}
```
往 res 对象中添加方法，方法名为 key，值为 mappedGetter 函数，函数执行，如果传入了命名空间但没有找到它对应的模块，直接返回。如果 val 不存在于全局 getters 中，说明用户传的 getter 名有误，打印错误提示并返回

上面情况都不出现的话，mappedGetter 返回全局 getters 中 val 对应的 getter。

遍历结束后，mapGetters 返回出填充好的 res 对象。用户可以用展开运算符把 res 对象展开到 computed 的选项对象中，从而注册为计算属性，可以返回全局 getters 中对应的 getter。

### mapActions
```js
const mapActions = normalizeNamespace((namespace, actions) => {
  const res = {}
  if (process.env.NODE_ENV !== 'production' && !isValidMap(actions)) {
    console.error('[vuex] mapActions: mapper parameter must be either an Array or an Object')
  }
  normalizeMap(actions).forEach(({ key, val }) => {
    res[key] = function mappedAction (...args) {
      // get dispatch function from store
      let dispatch = this.$store.dispatch
      if (namespace) {
        const module = getModuleByNamespace(this.$store, 'mapActions', namespace)
        if (!module) return
        dispatch = module.context.dispatch
      }
      return typeof val === 'function'
        ? val.apply(this, [dispatch].concat(args))
        : dispatch.apply(this.$store, [val].concat(args))
    }
  })
  return res
})
```

和前面俩一样，mapActions 执行，实际执行传入 normalizeNamespace 的回调。在回调中，首先创建空对象 res。mapActions 接收的 actions 必须是数组或纯对象，normalizeMap 会将该 action 转成一个数组，每项都类似 { key, val }，遍历数组，往 res 对象中添加方法：方法名为 action 名，值为 mappedAction 函数。res 对象经过展开后传入 methods 选项对象中，所以 mappedAction 函数就注册为一个 method。

args 是 method 所接收的参数数组，在 method 中，首先把 store.dispatch 方法赋给 dispatch，如果 mapActions 调用时传了 namespace，则获取它对应的模块，获取不到就直接返回，获取到就把 dispatch 覆盖为模块对应的本地 dispatch。

最后判断用户传的 map 对象中的 val 是否是函数，如果是，则直接调用并返回，this 指向当前 Vue 实例。如果不是函数，则调用 dispatch 方法，this 指向 store 对象，传入 action 名 val，和作为 method 接收的参数。因此，由 mappedAction 函数注册成的 method 就是用来分发 action 的。

用户可以这么使用 mapActions：

```js
methods:{
  ...mapActions(['action1','action2']),
  ...mapActions({
    myAction3: 'action3'
  }),
}
```
第一个 mapActions 返回的对象经过展开后，混入到 methods 选项对象中，注册成了 method，用来分发 action1 这个 action，相当于这样：

```js
methods：{
  action1(...args){
    // ...
    return this.$store.dispatch('action1', ...args)
  }
}
```
第二个 mapActions 返回的对象经过展开后混入 methods 选项对象中，注册 为 method，用来分发 action3 这个 action，相当于这样：

```js
methods：{
  myAction3(...args){
    // ...
    return this.$store.dispatch('action3', ...args)
  }
}
```

### mapMutations

```js
const mapMutations = normalizeNamespace((namespace, mutations) => {
  const res = {}
  if (process.env.NODE_ENV !== 'production' && !isValidMap(mutations)) {
    console.error('[vuex] mapMutations: mapper parameter must be either an Array or an Object')
  }
  normalizeMap(mutations).forEach(({ key, val }) => {
    res[key] = function mappedMutation (...args) {
      let commit = this.$store.commit
      if (namespace) {
        const module = getModuleByNamespace(this.$store, 'mapMutations', namespace)
        if (!module) return
        commit = module.context.commit
      }
      return typeof val === 'function'
        ? val.apply(this, [commit].concat(args))
        : commit.apply(this.$store, [val].concat(args))
    }
  })
  return res
})
```
同样的，mapMutations 执行，实际执行 normalizeNamespace 的回调，在回调中，准备了 res 对象，并对 res 对象进行填充最后返回出 res。

normalizeMap(mutations) 会对用户调用 mapMutations 时传入的 mutations 对象(可能是数组或对象)规范化为一个数组，每项是 {key, val} 形式的对象。遍历数组，解构出 key (即mutation名)和 val 属性值。遍历过程中，给 res 对象添加方法：方法名为 mutation 名，值为 mappedMutation 函数。

在 mappedMutation 函数中，首先将 store.commit 赋给 commit，如果用户调用 mapMutations 时传了命名空间，则获取它对应的模块的本地 commit 方法，覆盖给 commit。最后根据 val 是否是函数，如果是函数，返回 val 函数的执行结果，如果不是函数，返回 commit 的调用结果，传入 val 这个 mutation 名和参数。

用户可以这么使用 mapMutations：

```js
methods: {
  ...mapMutations(['muta1',  'muta2' ]),
  ...mapMutations({ myMuta3: 'muta3' }),
  ...mapMutations({
    myMuta4 (commit){
      commit('muta4')
    }
  })
}
```
它们被注册为 method 后，相当于这样的 method，这样的 method 是用来提交 mutation 的：

```js
methods: {
  myMuta4(commit, ...args){
    // ...
    return commit('muta4', ...args)
  }
}
```

于是我们讲完了4个辅助函数：mapState, mapGetters, mapMutations, mapActions 的原理，总结一下就是：

前两者是将 state/getter 名注册为计算属性名，然后 mappedState/mappedGetter 函数作为计算属性的 getter 函数，它的执行会返回对应的 state/getter。

后两者是将 mutation/action 名注册为 method 名，然后 mappedAction/mappedMutation 函数作为 method 方法，执行会分别 dispatch/commit 对应的 action 和 mutation。



 
 
 
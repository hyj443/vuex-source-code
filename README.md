# 逐行解析Vuex源码

## 回顾一下Vuex是什么

Vuex 是一个专为Vue框架设计的，进行状态管理的库，将共享的数据抽离，放到全局形成一个单一的store，同时利用了Vue内部的响应式机制来进行状态的管理和更新。
![vuex组成](https://vuex.vuejs.org/vuex.png)
Vuex，在全局有一个state存放数据，所有修改state的操作必须通过mutation进行，mutation的同时，提供了订阅者模式供外部插件调用，获取state数据的更新。
所有异步操作都走action，比如调用后端接口异步获取数据，action同样不能直接修改state，要通过若干个mutation来修改state，所以Vuex中数据流是单向的。
state的变化是响应式的，因为Vuex依赖Vue的数据双向绑定，需要new一个Vue对象来实现响应式化。

看源码之前再看一遍[Vuex文档](https://vuex.vuejs.org/zh/)会加深理解，建议抽空过一遍。

## Vuex的安装

Vuex 是 Vue 插件，在使用 Vuex 前，必须在 new Vue() 之前调用 Vue.use() 来安装 Vuex：

```js
import Vue from 'vue';
import Vuex from 'vuex';
Vue.use(vuex);

new Vue({
  // ...组件选项
})
```
>如果 Vue 插件是一个对象，它必须提供 install 方法。如果插件是一个函数，则它被作为 install 方法。install 接收的第一个参数就是 Vue 对象

src\index.js 入口文件中，Vuex 默认导出的对象如下：

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
可见对象中有 install 方法。Vue.use 执行时，会调用该 install 方法。我们看看 install：

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

如果是初次调用 install，定义的 Vue 还为 undefined，if 语句块不执行，install 接收的 _Vue 是 Vue 构造函数，它赋给了 Vue。如果再次调用 install，Vue 已经有值，且和传入的 _Vue 相同的话，则开发环境下会打印警告：Vuex已经安装了，Vue.use(Vuex)只能调用一次。然后直接返回，避免 Vuex 插件的重复安装。

接着调用 applyMixin(Vue)，我们看看 applyMixin 这个函数：

```js
export default function (Vue) {
  const version = Number(Vue.version.split('.')[0])
  if (version >= 2) {
    Vue.mixin({ beforeCreate: vuexInit })
  } else {
    // Vue 1.x 的处理，不做分析
  }
  function vuexInit () {
    // store 注入
  }
}
``` 

真正实现插件的安装是在 applyMixin 中，如果 Vue 的版本是 2.x，调用 Vue.mixin，混入一个 beforeCreate 钩子：vuexInit。Vue.mixin 的作用是：全局注册一个混入，会影响之后创建的每个 Vue 实例。

这意味着，install 之后，之后创建的每个 Vue 实例的执行 beforeCreate 钩子函数时，都会执行 vuexInit。

vuexInit 顾名思义是初始化 vuex：

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

vuexInit 钩子执行时，this 指向当前 Vue 实例，this.$options 获取的是当前 Vue 实例的 $options 对象。

如果 this.$options.store 存在，说明实例化 Vue 时传了 store 这个配置项。我们只有在创建 Vue 的根实例时，才会传入 store 对象：

```js
new Vue({
  store,
  router,
  render: h => h(App)
}).$mount('#app')
```

所以 this.$options.store 的存在说明当前实例是根实例，要给根实例添加 $store 属性，属性值为 options.store() 或 options.store，取决于 options.store 是否为函数。

如果当前不是根 Vue 实例，再判断如果它有父实例，并且父实例的 $store 有值，则也给当前实例添加 $store 属性，属性值为父组件的 $store 值。

可见 applyMixin 让每一个 Vue 组件实例的创建时，执行到 beforeCreate 钩子时，都会调用 vuexInit，给 Vue 组件实例添加 $store 属性，并且所有实例的 $store 属性都指向同一个 store 对象，即在任意组件中都可以通过 this.$store 访问根实例中注册的 store 对象

## store 对象的创建

根实例注册的 store 对象会向下注入到子组件实例中。问题来了，这个 store 对象是怎么创建的？它是通过实例化 Vuex.Store 创建的：

```js
const store = new Vuex.Store({
  state,
  mutations,
  actions,
  getters,
  modules
})
```

实例化 Vuex.Store 时传入一个包含 actions、getters、state、mutations、modules 等的配置对象，返回出 Store 实例。

我们看看 Store 这个构造函数。因为代码较长，我们拆分成几段：

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

首先判断，如果本地 Vue 没有值（说明没有调用过 install），且当前是浏览器环境，且 window.Vue 存在，则传入 window.Vue 执行 install。这意味着 Vuex 在用户没有调用 Vue.use(Vuex) 时，能主动进行安装。

Vuex 的使用需要一些必要条件。在开发环境中，会执行3个 assert 函数，如果条件不具备则会抛错。

```js
export function assert (condition, msg) {
  if (!condition) throw new Error(`[vuex] ${msg}`)
}
```
3个assert函数所做的事是：

1. 如果本地 Vue 没有值，抛出错误：实例化 Store 之前必须调用 Vue.use(Vuex)。因为这样 Vue 构造函数才能传进来，供后续使用
2. 如果 Promise 不能用，抛出错误：Vuex 依赖 Promise。
3. 如果 Store 函数里的 this 不是 Store 的实例，抛出错误：Store 必须用 new 关键字调用

判断完环境后，开始初始化 Store 实例的属性，它们会保存一些内部状态：

```js
const { plugins = [], strict = false } = options
this._committing = false // 提交mutation状态的标志
this._actions = Object.create(null) // 存放actions
this._actionSubscribers = [] // action 订阅函数集合
this._mutations = Object.create(null) // 存放mutations
this._wrappedGetters = Object.create(null) // 存放getters
this._modules = new ModuleCollection(options) // module收集器
this._modulesNamespaceMap = Object.create(null) // 模块命名空间
this._subscribers = [] // 存储所有对mutation变化的订阅者
this._watcherVM = new Vue() // Vue实例
this._makeLocalGettersCache = Object.create(null)//存放生成的本地getters的缓存
// ...
this.strict = strict
```

如果实例化 Store 时传了 strict: true，则 Store 实例的 strict 属性为 true，代表严格模式，任何 mutation 处理函数以外修改 state 都会抛出错误。如果用户没传 strict 选项，则 store 实例的 strict 属性默认为 false。

我们暂时不具体了解每一个的实例属性的含义。但其中的重点是：

 `this._modules = new ModuleCollection(options)`
 
创建了 ModuleCollection 的实例赋给了实例属性 _modules，稍后会详细介绍，接下来继续看 Store 构造函数 ：

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

首先定义 store 变量指向当前 store 实例。再定义 dispatch 和 commit，通过解构 this 分别缓存了 Store 原型上的 dispatch 和 commit 方法。

接着，给 store 实例添加 dispatch 和 commit 方法，方法调用实际执行刚刚缓存的 dispatch 和 commit 方法，但执行时的 this 指向当前 store 实例。

具体 Store 原型上的 dispatch 和 commit 方法做了什么事情，后面会讲。

接着看 Store 构造函数：

```js
this.strict = strict
const state = this._modules.root.state
installModule(this, state, [], this._modules.root)
resetStoreVM(this, state)
plugins.forEach(plugin => plugin(this))
```
从 options 中解构出来的 strict 属性值，赋给 store 实例的 strict 属性。

前面提到，this._modules 是 ModuleCollection 的实例，我们稍后会讲到，它的 root 属性的值是根 module 对象，根 module 对象的 state 属性指向它的 state 对象。所以这里获取根 state 赋给 state 变量。

调用 installModule 进行模块的注册，传入 store 实例、根 state、[]、根 module 对象。

调用 resetStoreVM 函数，对 state 进行响应式化处理

遍历 plugins 数组，逐个注册 Vuex 自己的插件

上面这些后面会展开讲。到目前为止，Store 构造函数已经过了一遍。new Store 主要做了三件事：

1. 初始化一些内部属性，其中重点是 this._modules = new ModuleCollection(options)
2. 执行 installModule ，安装模块
3. 执行 resetStoreVM ，使store响应式化

我们将逐个细说这三个，先说初始化 _module 属性，即 new ModuleCollection(options)

### Module 收集

```js
this._modules = new ModuleCollection(options)
```

Vuex文档里是这么说：

> store 使用单一的状态树，用一个对象包含了全部的应用层级的状态，每个应用将仅仅包含一个 store 实例。

如果应用变得很复杂，store 对象就可能很臃肿。为了解决这个问题，Vuex 允许我们将 store 分割成模块(module)，每个模块都有自己的 state 、mutation、action、getter、甚至是嵌套子模块，像下面这样从上至下进行同样方式的分割：

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

上面是使用 module 的写法，store 本身可以看作是一个根 module，它有嵌套的子 module，形成一种用配置对象描述的树形结构。

new ModuleCollection 所实现的，是将这种树形结构转成通过父子关系彼此关联的单个对象的存在，即进行 module 的收集。

我们看看 `ModuleCollection` 构造函数：

```js
class ModuleCollection {
  constructor (rawRootModule) {
    this.register([], rawRootModule, false)
  }
  register (path, rawModule, runtime = true) {
    // ...
  }
  // ...
}
```
可见，new ModuleCollection(options) 就是执行原型方法 register：

```js
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
  // register nested modules
  if (rawModule.modules) {
    forEachValue(rawModule.modules, (rawChildModule, key) => {
      this.register(path.concat(key), rawChildModule, runtime)
    })
  }
}
```
先解释 register 方法接收的这 3 个参数：

1. path：module 对象的属性名组成的数组，是 module 对象的唯一标识。
  像刚刚的例子，根 module 的 path 为 []，它的子模块 moduleA 的 path 是 ['a']，子模块 moduleB 的 path 是 ['b']，如果它们各自还有子模块，则它们的 path 就大致形如 ['a','a1']、['b','b1']
2. rawModule：定义当前 module 的 options 对象，后面统称为配置对象。rawRootModule 就是实例化 Store 时传入的配置对象，因为我们把创建的 store 对象看作是根 module，所以我们把它的配置对象看作根 module 的配置对象。
3. runtime 表示是否是一个运行时创建的 module，默认为 true。

```js
this.register([], rawRootModule, false)
```
new ModuleCollection(options)时，首次调用 register，第一个参数传入空数组，说明 register 的是根 module。rawRootModule 是实例化 Store 时传入的配置对象。

我们具体分段看 register 的内部：

```js
assertRawModule(path, rawModule)
const newModule = new Module(rawModule, runtime)
```
首先调用 assertRawModule 对 module 的配置对象作一些判断，遍历用户传的配置对象中的 getters、mutations、actions，判断是否符合要求，这里不作具体分析。

然后根据当前的配置对象 rawModule，创建一个 Module 实例，赋给变量 newModule。后面会详谈 Module 构造函数。

继续看 register：

```js
if (path.length === 0) {
  this.root = newModule
} else {
  const parent = this.get(path.slice(0, -1))
  parent.addChild(path[path.length - 1], newModule)
}
```

如果 path 是空数组，说明当前注册的 module 是根 module，则把刚刚创建的 Module 实例赋给 this.root，this 指向当前 ModuleCollection 的实例，即它的 root 属性保存了根 module 对象。

如果 path 不是空数组，即当前 register 的是子 module，稍后会讲解。

接下来是的 register 函数的最后一部分：

```js
if (rawModule.modules) {
  forEachValue(rawModule.modules, (rawChildModule, key) => {
    this.register(path.concat(key), rawChildModule, runtime)
  })
}
```
如果当前配置对象 rawModule 的 modules 属性有值，说明用户给它配置了子 module，则需要调用 forEachValue 遍历 modules 对象，进行子模块的递归注册，我们先看看 forEachValue 函数：

```js
export function forEachValue (obj, fn) {
  Object.keys(obj).forEach(key => fn(obj[key], key))
}
```

forEachValue 函数会遍历传入的 obj 对象的自有属性 key，逐个调用 fn。

所以这里做的是：遍历 rawModule.modules 对象里的每个 key，它们是子模块配置对象的键名，执行回调，传入 key 对应的配置对象 rawChildModule 和 key。在回调中会调用 register 函数，对子模块进行注册。

此时传入 register 的 path 是 `path.concat(key)`。我们知道，path 是当前注册的模块的路径，concat 上当前遍历的 key，就是当前子模块的路径。

比如模块 a 嵌套了模块 b，模块 b 嵌套了模块 c，那模块 c 的path是：['a','b'].concat('c')，即['a','b','c']

第二个参数rawChildModule，是当前遍历的属性值，即子模块的配置对象。

我们现在捋一捋：实例化 Store 必然会实例化 MoudleCollection，进行 module 的收集，至少会调用一次 register 进行根 module 的注册，如果根配置对象配置了嵌套的子模块，则会继续调用 register 注册子 module。子模块的 path 不是空数组，回到刚刚那个 else 语句块:

```js
if (path.length === 0) {
  this.root = newModule
} else {
  const parent = this.get(path.slice(0, -1))
  parent.addChild(path[path.length - 1], newModule)
}
```

此时 path 是当前注册的子模块的路径，path.slice(0, -1) 是去掉最后一项的数组，它代表的是父模块的 path。将它传入 get 方法执行，是为了获取该当前子模块的父 module 对象，我们看看 get 这个 ModuleCollection 的原型方法：

```js
get (path) {
  return path.reduce((module, key) => {
    return module.getChild(key)
  }, this.root)
}
```

reduce 的详细用法可以参考 [reduce - MDN](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Array/Reduce)

我们先看一下 getChild 和 addChild 这两个 Module 的原型方法，再回来理解 get。

```js
getChild (key) {
  return this._children[key]
}
addChild (key, module) {
  this._children[key] = module
}
```

getChild 方法返回的是 this._children[key]，即通过 key 获取到当前 module 的子 module 对象，我们讲 Module 构造函数时会讲 _children 属性。

addChild 方法是给当前 module 对象的 _children，添加 key 和对应的子模块对象。到这里你可以猜到父子 module 对象的关系是靠 _children 建立的。

回到 ModuleCollection 的原型方法 get：

```js
get (path) {
  return path.reduce((module, key) => {
    return module.getChild(key)
  }, this.root)
}
```
为了方便理解，假设传入 get 的 path 为 ['a','b','c']

reduce 累加器的初始值为 this.root，是根 module，第一次迭代中，执行回调返回的是：根 module 的 key 为 'a' 的子 module，并且该子 module 会作为下一次迭代的累加器的值，即传给回调的第一个参数 module，第二次迭代执行返回的是：'a' 模块下的子模块 'b' 的模块对象，以此类推，最后 get 方法返回 ['a','b','c'] 对应的模块。

所以 get 方法是根据 path 数组，通过 reduce 迭代，返回出 path 对应的 module 对象。

所以，获取到当前模块的父模块对象，赋给 parent，然后调用 addChild 方法，给父模块对象的 _children 属性，添加当前子模块对象。

```js
 const parent = this.get(path.slice(0, -1))
 parent.addChild(path[path.length - 1], newModule)
```

path[path.length - 1]，path 数组的最后一项，即当前模块的 key 名，newModule 是当前模块对象，它们将作为键值对添加到父模块对象的 _children对象中

通过 module 的 _children 属性，建立了父子模块对象之间的父子关系。现在未加工的配置对象形成的树形结构，已经转成了一个个散落的父子 module 对象。

我们再整体梳理一下 register方法：

```js
register (path, rawModule, runtime = true) {
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
```

首先 register 方法必然至少调用一次，在实例化 Store 时，会调用 new ModuleCollection，执行 register 将根配置对象被注册为根 module 对象，只要配置了嵌套模块，就会递归调用 register，注册每一个子模块，每一个子模块都通过 path 找到自己的父模块对象，通过 addChild 添加 _children 属性建立父子关系，然后再看自己有没有嵌套子模块，如果有就继续递归调用 register，最后完成整个 module 树的注册。

概况来说，new ModuleCollection(即 register 的执行)，做了两件事：

1. 根据 rawModule 配置对象通过 new Module 创建 module 对象
2. 通过递归调用 register，建立父子 module 对象之间的父子关系

new Module 是在 new ModuleCollection 的过程中发生的，先生成 module 对象，再进行 module 对象父子关系的收集。

提一下，module 对象或模块对象，都指的是 Module 实例。我们看看 Module 构造函数

## Module 构造函数

用户定义的 module 配置对象称为 rawModule，未经加工的配置对象，传入 new Moudle 执行后，实现了从 rawModule 到 module 对象的转变。

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
Module的实例会挂载一些属性：比如 _children，初始化为一个空对象，用来存放当前模块对象的子模块对象。 _rawModule 属性，属性值为当前模块的配置对象。state 属性，属性值为该模块配置对象的 state 对象。

我们可以使用一个返回一个对象的函数来声明模块的state，返回的对象会被用作state，赋给 this.state

和Vue组件里的data一样，如果使用一个纯对象来声明模块的state，那么这个state对象会通过引用被共享，导致state对象被修改时，store或模块间数据相互污染。

因为有时我们可能需要创建一个模块的多个实例，比如，创建多个store实例，或在一个store中多次注册同一个模块

namespaced是Module的原型属性，使用get给它的属性描述符对象添加了get方法，当Module实例读取namespaced时，会沿着原型链找到并读取原型上的namespaced，触发了它的get方法，返回模块的配置对象的namespaced属性值的真假

### installModule

我们在讲 Store 的 constructor 时，讲了它重点的做的三件事，现在我们讲完了模块对象的创建和建立父子关系，接着就是模块的安装(初始化根模块对象)，也就是 constructor 中的这句：

```js
installModule(this, state, [], this._modules.root)
```
我们看看installModule的实现：

```js
function installModule(store, rootState, path, module, hot) {
  const isRoot = !path.length // 是否为根module
  const namespace = store._modules.getNamespace(path) // 获取module的namespace
  if (module.namespaced) {
    if (store._modulesNamespaceMap[namespace] && process.env.NODE_ENV !== 'production') {
      console.error(`[vuex] duplicate namespace ${namespace} for the namespaced module ${path.join('/')}`)
    }
    store._modulesNamespaceMap[namespace] = module
  }
  if (!isRoot && !hot) { // 不为根且非热更新
    const parentState = getNestedState(rootState, path.slice(0, -1)) // 获取父级的state
    const moduleName = path[path.length - 1] // module的name
    store._withCommit(() => { // 将子module设置成响应式的
      Vue.set(parentState, moduleName, module.state)
    })
  }
  const local = module.context = makeLocalContext(store, namespace, path)
  module.forEachMutation((mutation, key) => {...}) // 遍历注册mutation
  module.forEachAction((action, key) => {...}) // 遍历注册action
  module.forEachGetter((getter, key) => {...})// 遍历注册getter
  module.forEachChild((child, key) => { // 递归安装module
    installModule(store, rootState, path.concat(key), child, hot)
  })
}
```
由Vuex文档可知：

Vuex 2后的版本添加了命名空间的功能，使用了module后，state就被模块化，比如要调用根模块的state，则`store.state.xxx`，如果要调用a模块的state，则调用`store.state.a.xxx`。

但默认情况下，模块内部的 action、mutation 和 getter 是注册在全局命名空间的，比如，不同模块有同名的mutation，会导致多个模块能够对同一个 mutation 作出响应。

如果希望你的模块具有更高的封装度和复用性，你可以通过添加 namespaced: true 的方式使其成为带命名空间的模块。当模块被注册后，它的所有 getter、action 及 mutation 都会自动根据模块注册的路径调整命名。例如：

```js
const store = new Vuex.Store({
  modules: {
    account: {
      namespaced: true,
      state: {}, 
      getters: {
        isAdmin() {...} // -> getters['account/isAdmin']
      },
      actions: {
        login() {...} // -> dispatch('account/login')
      },
      mutations: {
        login() {...} // -> commit('account/login')
      },
      modules: { // 继承父模块的命名空间
        myPage: {
          state: {},
          getters: {
            profile() {...} // -> getters['account/profile']
          }
        },
        posts: {
          namespaced: true,// 进一步嵌套命名空间
          state: {},
          getters: {
            popular() {...} // -> getters['account/posts/popular']
          }
        }
      }
    }
  }
})
```

我们先看 installModule 它接收什么参数：

- store：Store实例，就是new Vuex.Store时传入的store对象。
- rootState：根state对象
- path：当前的模块对应的路径数组
- module：当前模块对象
- hot：是否支持热重载（这里不讨论它）

installModule 代码较长，我们分段来看

```js
const isRoot = !path.length
const namespace = store._modules.getNamespace(path)
if (module.namespaced) {
  if (store._modulesNamespaceMap[namespace] && process.env.NODE_ENV !== 'production') {
    console.error(`[vuex] duplicate namespace ${namespace} for the namespaced module ${path.join('/')}`)
  }
  store._modulesNamespaceMap[namespace] = module
}
```

首先，使用变量isRoot来标识当前模块是否为根模块，接着，调用getNamespace函数传入path，获取当前module的命名空间。我们看看ModuleCollection的原型方法getNamespace：

```js
getNamespace (path) {
  let module = this.root
  return path.reduce((namespace, key) => {
    module = module.getChild(key)
    return namespace + (module.namespaced ? key + '/' : '')
  }, '')
}
```
getNamespace 首先获取到根module对象，然后调用path数组的reduce方法，累加器初始值为''，沿着path，每次迭代获取到子模块对象module，如果module.namespaced存在，即当前模块的配置对象中传了namespaced为真值，就将上一次执行回调的返回值拼上当前的key字符串和'/'，否则拼接''。

reduce迭代结束时，返回出当前模块的namespace，称它为命名空间字符串。

```js
if (module.namespaced) {
  if (store._modulesNamespaceMap[namespace] && process.env.NODE_ENV !== 'production') {
    console.error(`[vuex] duplicate namespace ${namespace} for the namespaced module ${path.join('/')}`)
  }
  store._modulesNamespaceMap[namespace] = module
}
```
如果当前模块使用了命名空间，再判断，store对象的属性_modulesNamespaceMap，如果该对象中已经存在当前命名空间，则报错提示：命名空间的名称重复了。如果没有，则将命名空间和它对应的模块对象，作为键值对添加到_modulesNamespaceMap对象中

继续看installModule的代码：

```js
if (!isRoot && !hot) { // 不为根且非热更新
  const parentState = getNestedState(rootState, path.slice(0, -1)) // 获取父级的state
  const moduleName = path[path.length - 1] // module的name
  store._withCommit(() => { // 将子module设置成响应式的
    Vue.set(parentState, moduleName, module.state)
  })
}
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
如果当前模块不是根模块，且非热更新，执行if语句块。

首先，根据根state和父模块的path，通过调用getNestedState函数，获取当前模块的父state。我们结合 getNestedState 来看：

```js
function getNestedState (state, path) {
  return path.reduce((state, key) => state[key], state)
}
```

父模块的path调用reduce，累加器的初始值为根state，每次迭代返回出它的子模块的state，沿着path路径，一个个往下获取子state，直到获取到当前state的父state。就比如`store.state` >> `store.state.a` >> `store.state.a.b`...

`const moduleName = path[path.length - 1]` 获取到当前模块的key名，赋给moduleName

接着调用了Store的原型方法_withCommit，传入一个回调函数，我们先看看函数中做了什么

```js
if (process.env.NODE_ENV !== 'production') {
  if (moduleName in parentState) {
    console.warn(
      `[vuex] state field "${moduleName}" was overridden by a module with the same name at "${path.join('.')}"`
    )
  }
}
Vue.set(parentState, moduleName, module.state)
```

如果是在开发环境中，则判断当前模块的key名(比如叫value)，已经存在于父模块(假定模块名叫foo)的state对象中，会有这样的问题：当你通过store.state.foo.value获取父模块foo的state的value值时，你拿到的却是当前这个子模块value的配置对象，即父模块的state的value属性被覆盖了，所以要报错提示。

然后执行 `Vue.set(parentState, moduleName, module.state)`，给父模块的state对象添加响应式属性，属性名为当前模块名，属性值为模块的state对象。

我们先看看_withCommit这个Store的原型方法

```js
_withCommit (fn) {
  const committing = this._committing
  this._committing = true
  fn()
  this._committing = committing
}
```
_withCommit接收函数fn，首先把当前store的_committing置为true，然后执行fn，再把 _committing属性值恢复到原来的值。可见，_withCommit的作用是让fn执行的过程中，_committing的值为true。

因为fn中有修改state的操作。所有合法的修改state的操作发生时，都将它放入_withCommit的回调fn，让这个过程的_committing为true，其他时刻都默认为false，因此任何非法修改state的动作都会报错提示："do not mutate vuex store state outside mutation handlers."

接下来，注册 mutation 等：

```js
const local = module.context = makeLocalContext(store, namespace, path)

module.forEachMutation((mutation, key) => {
  const namespacedType = namespace + key
  registerMutation(store, namespacedType, mutation, local)
})
```

首先执行makeLocalContext方法，传入store对象，当前模块的命名空间，当前的模块路径path，返回值赋给local和module.context。

我们看看 makeLocalContext 的实现：

```js
function makeLocalContext (store, namespace, path) {
  const noNamespace = namespace === ''
  const local = {
    // ...
  }
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
}
```
首先用noNamespace这个布尔值，代表该模块是否使用了命名空间。然后创建一个对象local，里面定义了dispatch、commit方法和getters、state属性，最后返回出local对象

我们看看local的dispatch方法：

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
  }
}
```
如果该模块没有使用命名空间，则local.dispatch直接使用store对象的dispatch方法。

如果该模块存在自己的命名空间，则定义local.dispatch为一个新的函数，函数可以接收三个参数：_type：即action的名称、_payload：载荷对象、_options：配置对象，这三个参数传入unifyObjectStyle函数执行，返回值赋给args。

我们看看unifyObjectStyle：

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
unifyObjectStyle函数的作用是对参数做归一化处理：如果第一个参数是对象且存在type属性，则传入的第二个参数作为options，第一个参数作为payload对象，type取第一个参数的type属性

开发环境下，如果type不是字符串，抛出错误。

最后返回出包含type, payload, options的对象。

回到local.dispatch方法，args拿到处理好的参数对象后，从中解构出type, payload, options变量。

```js
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
```

如果options不存在或options对象里没有root，则将type改为命名空间字符串和type的拼接。

开发环境下判断，如果store对象的存放actions的_actions对象里，没有名为type的action，就报错提示并直接返回。

最后返回出store对象的dispatch的执行结果，传入的是结合了命名空间的全局type，和payload载荷对象。

再来看local.commit，如果当前模块没有命名空间，直接用store.commit，否则定义local.commit方法：

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
commit是提交mutation的方法，定义的新函数接收三个参数：_type：mutation的名字，_payload：载荷对象，_options：配置对象。经过unifyObjectStyle函数处理成对象args。从args对象中解构出type, payload, options变量。

如果options不存在或options对象里没有root，就将type改写命名空间字符串和type的拼接。

开发环境下判断，如果store对象的存放mutation的_mutations对象里，没有名为type的mutation，就报错提示并直接返回。

最后返回出store对象的commit的执行结果，传入的是结合了命名空间的全局type，和payload载荷对象。

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
用Object.defineProperties给local对象定义两个响应式属性：getters和state。

读取local.state时，会触发state的get方法，返回getNestedState的执行结果，getNestedState获取的是当前模块的state对象。

读取local.getters时，会触发getters的get方法，如果当前模块没有命名空间，则get方法执行直接返回store.getters，如果有命名空间，get方法执行返回makeLocalGetters函数的执行结果，传入的是store对象和当前的命名空间。

看看makeLocalGetters函数：

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
store对象有个_makeLocalGettersCache属性，是一个对象专门存放生成的本地getters的缓存，根据namespace查看缓存对象中有没有，如果有就直接返回缓存值，如果没有就执行if语句块。

进入if语句块，首先定义一个getters的代理对象gettersProxy，然后获取命名空间字符串的长度splitPos。然后遍历store.getters对象，如果type字符串从开头截取到索引splitPos和命名空间字符串不相等，说明store.getters中该getter的type的前面的部分不匹配当前模块的命名空间，直接返回。

然后获取本地的type，即本地的getter名，赋给localType，在gettersProxy对象上定义localType只读属性，读取它时返回store.getters中全局type对应的getter。

遍历完store.getters后，gettersProxy就存放着属性名为localType的，属性值为对应的getter

将gettersProxy赋给store._makeLocalGettersCache[namespace]，_makeLocalGettersCache对象中，namespace就对应的属性值是一个对象，存放的是本地的getter名和对应的getter

综上，makeLocalGetters就是根据命名空间生成对应的本地getters对象，可以通过本地type访问全局type对应的getter。到此local对象填充完毕，makeLocalContext函数返回local对象

```js
const local = module.context = makeLocalContext(store, namespace, path)
```

回到installModule函数，现在makeLocalContext函数返回的local对象，赋给了变量local 和 module.context，这个local对象里有为当前模块设置局部化的dispatch、commit方法，和getter和state属性

然后调用Module的原型方法forEachMutation，将回调函数传入执行

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
forEachMutation 中，判断如果当前模块的配置对象传了mutations，就调用forEachValue遍历mutations对象，对每个键值对执行fn。

在fn中，首先将当前遍历的mutation所在的模块的命名空间字符串，拼接上，自己的key名，赋给namespacedType，它就是结合了namespace的mutation名。

调用 registerMutation 进行 mutation 方法的注册，我们看看registerMutation函数：

```js
function registerMutation (store, type, handler, local) {
  const entry = store._mutations[type] || (store._mutations[type] = [])
  entry.push(function wrappedMutationHandler (payload) {
    handler.call(store, local.state, payload)
  })
}
```
结合`registerMutation(store, namespacedType, mutation, local);`来看

registerMutation函数可以接收4个参数：

1. store：store对象，即唯一的new Vuex.Store创建的store实例
2. type：即namespacedType，拼接了命名空间字符串的全局的mutation名
3. handler：mutation的属性值，即mutation对应的处理函数。
4. local ：local对象包含给当前模块设置的局部化的dispatch、commit方法，和getters、state属性

` var entry = store._mutations[type] || (store._mutations[type] = []);`

已知store实例的属性_mutations，是个存放mutation的数组，如果融合了命名空间的全局type在store._mutations对象中，找不到对应的mutation，那就将store._mutations[type]初始化为一个空数组，用来存放type对应的mutation。注意，store._mutations[type]和entry指向同一个内存空间。

```js
entry.push(payload => {
  handler.call(store, local.state, payload);
})
```
这是往store._mutations[type]数组推入一个mutation函数，它执行就是传入的handler的执行，handler执行时this指向store对象，注意，handler执行时接收的是local.state，局部化的state，和mutation函数接收的payload载荷对象。

于是遍历完当前模块的mutations对象，给每一个type都注册了对应的mutation函数，存放在store._mutations[type]数组中

接着，是action的注册

```js
module.forEachAction((action, key) => {
  const type = action.root ? key : namespace + key
  const handler = action.handler || action
  registerAction(store, type, handler, local)
})

forEachAction (fn) {
  if (this._rawModule.actions) {
    forEachValue(this._rawModule.actions, fn)
  }
}
```
forEachAction函数中，如果当前模块的配置对象传了actions，则调用forEachValue遍历actions，执行回调函数fn，fn接收action和对应的key。

在fn中，如果用户在action配置对象中传了root: true，说明他想在带命名空间的模块中注册全局的action，那么直接把key赋给type，否则还是空间字符串拼接key

用户配置actions时，可以写成对象形式，对象的handler属性传处理回调，也可以直接写成函数，因此优先获取第一个参数中的handler属性值，如果没有，直接取第一个参数。

调用registerAction进行action的注册。

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
      return res.catch(err => {
        store._devtoolHook.emit('vuex:error', err)
        throw err
      })
    } else {
      return res
    }
  })
}
```
首先判断store._actions这个对象是否存在type属性对应的数组，如果没有，则初始化为空数组，它存放type对应的action，向数组中推入一个包裹aciton的处理函数，即wrappedActionHandler。

wrappedActionHandler中：首先会调用用户设置的action的handler，调用结果赋给res缓存起来，handler执行时的this指向store对象，handler接收一个对象，它包含和store对象一样的方法和属性，称它为context对象，还接收wrappedActionHandler传入的payload。

然后判断res，如果不是promise实例，就将它包裹成resolve值为res的promise实例。最后返回res。(不考虑使用了devtools的情况)

接着，注册getter

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
forEachGetter函数中，如果当前模块的配置对象中传了getters，遍历它，执行回调函数fn。

在fn中，将当前模块的命名空间和key结合起来，赋给namespacedType，调用registerGetter注册getter

```js
function registerGetter (store, type, rawGetter, local) {
  if (store._wrappedGetters[type]) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[vuex] duplicate getter key: ${type}`)
    }
    return
  }
  store._wrappedGetters[type] = function wrappedGetter (store) {
    return rawGetter(
      local.state, // local state
      local.getters, // local getters
      store.state, // root state
      store.getters // root getters
    )
  }
}
```
registerGetter函数中，首先判断，如果store._wrappedGetters对象中，全局type对应的getter已经存在，就报错提示：你这个getter的key名字重复了。然后直接返回

如果type对应的getter不存在，那就往store._wrappedGetters对象中添加属性type和对应的wrappedGetter方法。它是rawGetter方法的封装。

rawGetter就是遍历getters对象时，传入回调的getter方法。rawGetter执行传入的是local对象的state、getters、和根state，根getters。

mutation、action、getter都注册完了，到了installModule的最后一步，遍历当前模块的子模块，进行子模块的安装：

```js
module.forEachChild((child, key) => {
  installModule(store, rootState, path.concat(key), child, hot)
})
forEachChild (fn) {
  forEachValue(this._children, fn)
}
```

当前的模块调用forEachChild方法，将回调函数传入，遍历当前模块的_children数组，它存放着它的子模块对象，执行fn，fn中递归调用installModule去安装子模块，传入的分别是：store对象，根state对象，子模块对象的path，子模块对象，和hot。

这样，子模块也得到了安装，即子模块的mutation、action、getter得到了注册。

## resetStoreVM

好了，我们现在来到实例化 Store 构造函数的核心三件事的最后一件：响应式化state
Vuex文档的原话：

>Vuex 的状态存储是响应式的。当 Vue 组件从 store 中读取 state 时，若 store 中的 state 发生变化，那么相应的组件也会相应地得到更新。

那Vuex是如何把state对象转成响应式的数据呢？原因在下面这句：

```js
resetStoreVM(this, state)
```

传入的this是store对象，state是根state，我们看看 resetStoreVM：

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
      enumerable: true // for local getters
    })
  })
  const silent = Vue.config.silent
  Vue.config.silent = true
  store._vm = new Vue({
    data: {
      $$state: state
    },
    computed
  })
  Vue.config.silent = silent

  if (store.strict) {
    enableStrictMode(store)
  }
  if (oldVm) {
    if (hot) {
      store._withCommit(() => {
        oldVm._data.$$state = null
      })
    }
    Vue.nextTick(() => oldVm.$destroy())
  }
}
```

逐段分析：

```js
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
```
因为函数中要创建新的Vue实例赋给store._vm，创建前先将store._vm赋给 oldVm，保存一份旧值

给store对象上添加getters属性，值为一个空对象，添加_makeLocalGettersCache属性，值为一个空对象。定义变量wrappedGetters，指向store._wrappedGetters，里面存放的是已经注册好的getter方法。再定义一个computed变量，指向一个空对象。

遍历wrappedGetters对象，给computed对象添加方法，key为getter的名称，值为partial函数的返回值。

```js
function partial (fn, arg) {
  return () => {
    return fn(arg)
  }
}
```

注意传入 partial 的是getter函数和store对象，partial返回一个新的函数，函数执行实际执行的是传入的fn，即getter函数，getter函数接收store对象执行。

也就是，computed对象所添加的getter方法是被包裹了一层的，这么做的好处是，getter在函数外部执行，也能通过闭包引用了函数作用域中的store这个私有形参，这个store不会随着resetStoreVM执行结束而销毁。

```js
Object.defineProperty(store.getters, key, {
  get: () => store._vm[key],
  enumerable: true
})
```
遍历过程中，通过Object.defineProperty在store.getters添加getter属性，读取它的值时会执行它的get函数，返回store._vm[key]，即返回vue实例上的计算属性

store._vm上为什么会有xxx属性呢，原因是：

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
首先获取Vue.config.silent的值。用户在使用Vue时，如果将它配置为真，是为了取消Vue所有的日志与警告。

将Vue.config.silent置为true，保证创建Vue实例时，不出现Vue的日志与警告，创建完Vue实例后，将它恢复为原来的值

实例化Vue，data选项传入$$state: state，$$state成了响应式属性，根state对象会被深度观测，即根state对象中的属性被转成响应式属性，并且我们知道Vue实例会直接代理Vue实例的_data对象，所以store._vm会代理store._vm._data中的数据，所以访问store._vm.$$state就相当于访问store._vm._data.$$state。

Store构造函数有state这个原型属性：

```js
get state () {
  return this._vm._data.$$state
}
```
我们知道所有组件实例的$store属性值，都指向同一个根store对象，读取this.$store.state的话，就是读取 store.state，会触发state的get函数，返回的是store._vm._data.$$state

即响应化了state后，访问store.state都是返回vm实例的data中的响应式数据

```js
store._vm = new Vue({
  data: {
    $$state: state
  },
  computed
})
```
因为computed对象存了getter方法，把computed对象作为computed选项传入new Vue后，被初始化为计算属性。

比如访问this.$store.getters.xxx时，即访问store.getters.xxx，我们已经给store.getters定义了响应式只读属性，所以会触发xxx属性的get函数，返回store._vm.xxx，为什么store._vm.xxx能获取到对应的getter方法呢，因为xxx已经被注册为Vue实例store._vm的计算属性了，所以store._vm.xxx可以访问到xxx的getter方法。

## Vuex.Store实例方法的实现
### commit

更改 store中的state的唯一的方法是提交 mutation，mutation都有一个字符串的type和一个handler回调函数，handler做的就是改变state，并且会接收state作为第一个参数，比如：
```js
const store = new Vuex.Store({
  state:{
    a:1
  }
  mutations:{
    change(state){
      state.a++
    }
  }
})
```
这其实就像一种事件的注册，当你调用store.commit触发"change"这个type类型的mutation时，会调用它的handler回调函数，注意，并不能直接调用mutation的handler

```js
store.commit('change')
```

commit是Store构造函数的原型方法，作用是提交mutation，我们看看它的实现：

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
  this._subscribers.forEach(sub => sub(mutation, this.state))
  // ...
}
```
commit最多接收3个参数：

_type：要提交的mutation的type字符串，可以称它为mutation名
_payload：载荷(一般用户会传一个对象)
_options：配置对象，可以传root: true，它允许在命名空间模块里提交根的mutation

commit提交mutation的另一种方式是直接传一个包含type属性的对象：

```js
 store.commit({
   type:'change',
   amount: 10
 })
```
我们分段来看看commit的代码：

```js
const {type, payload, options} = unifyObjectStyle(_type, _payload, _options)
const mutation = { type, payload }
const entry = this._mutations[type]
if (!entry) {
  if (process.env.NODE_ENV !== 'production') {
    console.error(`[vuex] unknown mutation type: ${type}`)
  }
  return
}
```
我们已经介绍过unifyObjectStyle函数，它对参数做统一化处理，从执行结果中解构出type, payload, options。

创建一个包含type和payload属性的对象，赋给mutation。获取store实例的_mutations对象中的type对应的mutation数组，赋给entry

如果entry不存在，在开发环境下，要打印警告：你传的type没有对应的mutation，然后直接返回

```js
if (!entry) {
  if (process.env.NODE_ENV !== 'production') {
    console.error(`[vuex] unknown mutation type: ${type}`)
  }
  return
}
```
如果 entry不存在，说明这个mutation没有注册过，所以你无法调用 store.commit 去提交这个mutation，会给你一个报警提示：未知的mutation type，然后直接返回

接下来，继续看：
```js
this._withCommit(() => {
  entry.forEach(function commitIterator (handler) {
    handler(payload)
  })
})
```
我们前面分析过 _withCommit做的事是把_committing先置为true，然后执行回调函数，执行完后再把_committing 恢复到原来的值。

我们先来看回调做了什么事：遍历数组entry，即this._mutations[type]数组，将数组每一个handler执行，传入用户调用commit时传入的payload。也就是，将type对应的handler(不管有几个)都执行一遍。

接下来：
```js
this._subscribers.forEach(sub => sub(mutation, this.state))
```

this._subscribers的this指向 store对象，_subscribers存放的是所有对mutation的订阅者
这是哪来的呢？？？其实我们看Vuex文档可知，Store有一个原型方法subscribe，虽然你很少用到它，它的作用是订阅mutation，然后handler会在mutation完成后调用，通常这个方法是用于插件，其实没啥必要看，既然都写到这了，看吧
```js
subscribe (fn) {
  return genericSubscribe(fn, this._subscribers)
}
function genericSubscribe (fn, subs) {
  if (subs.indexOf(fn) < 0) {
    subs.push(fn);
  }
  return function () {
    var i = subs.indexOf(fn);
    if (i > -1) {
      subs.splice(i, 1);
    }
  }
}
```
我们可以看到，subscribe接收一个回调函数fn，返回genericSubscribe的执行值，传入的是fn和存放所有对mutation的订阅者
genericSubscribe做了什么事，首先，如果subs数组中没有这个fn，就把它push进取
genericSubscribe执行返回一个函数，函数中会找到fn在subs数组中位置，并把fn从中删除。

。。。有点懵了
`this._subscribers.forEach(sub => sub(mutation, this.state))`
现在遍历 mutation 的订阅者数组，执行回调，sub就是你subscribe的时候自己写的回调fn，fn执行传入mutation和经过mutation后的state。

### dispatch

dispatch是Store的原型方法，作用是触发action。action通常进行异步操作，store.dispatch就用来处理action的处理函数执行返回的promise，并且store.dispatch执行也是返回promise。

```js
actions:{
  actionA({ commit }){
    return new Promise((resolve,reject)=>{
      // 异步操作
    })
  }
}
```
用store.dispatch分发action你可以这么写
```js
store.dispatch('actionA').then(()=>{
  // ....
})
```
好的，现在看看store.dispatch的实现，比较长，分段看吧：
```js
dispatch (_type, _payload) {
  const { type, payload } = unifyObjectStyle(_type, _payload)
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
调用unifyObjectStyle函数对dispatch函数接收的参数做归一化。

然后变量type, payload取到归一化后的type, payload，把他们放进一个对象，然后赋给变量action

定义entry，指向this._actions[type]，它是存放type对应的action方法的数组。

如果entry不存在，说明该type的action还没注册，报警提示；未知的action type，然后直接返回

接着继续：
```js
try {
  this._actionSubscribers
    .filter(sub => sub.before)
    .forEach(sub => sub.before(action, this.state))
} catch (e) {
  if (process.env.NODE_ENV !== 'production') {
    console.warn(`[vuex] error in before action subscribers: `)
    console.error(e)
  }
}
```
action的订阅函数。。。算了，这里我不想分析了，还没用过它

再接下来：
```js
const result = entry.length > 1
  ? Promise.all(entry.map(handler => handler(payload)))
  : entry[0](payload)
return result.then(res => {
  // 这是。。。先不太了解，做了一个try catch
  return res
})
```
如果entry数组的长度>1，说明type对应的action的处理函数有多个(同名action传了多个)，可能每个回调就管控一个异步操作，我们不能单纯地遍历执行action，而是要把每个action的执行结果(promise对象)放到一个数组里，传给Promise.all，给它管控。

所以将entry数组里每个handler执行，传入dispatch传入的payload，handler的执行结果覆盖数组的每项，然后map返回的是一个数组，传给Promise.all执行，执行返回值赋给result

如果entry数组只有1个元素，就将它这个handler函数传入payload执行，执行返回值赋给result

我们知道registerAction函数中将action的处理函数包裹成wrappedActionHandler函数，推入entry数组，它返回的一定是promise实例，所以result一定是promise实例，它调用then，做一些处理后，返回res。

## 辅助函数

### mapState

>当一个组件需要获取多个state时候，将这些state都声明为computed会有些重复和冗余。我们可以使用 mapState 辅助函数帮助我们生成计算属性
我们看看mapState函数的实现：
```js
  var mapState = normalizeNamespace(function (namespace, states) {
    var res = {};
    normalizeMap(states).forEach(function (ref) {
      // ...
    });
    return res
  });
```
可以看到它是normalizeNamespace函数的返回值，normalizeNamespace做了什么事情：
```js
function normalizeNamespace (fn) {
  return function (namespace, map) {
    if (typeof namespace !== 'string') {
      map = namespace;
      namespace = '';
    } else if (namespace.charAt(namespace.length - 1) !== '/') {
      namespace += '/';
    }
    return fn(namespace, map)
  }
}
```
可以看到normalizeNamespace接收一个函数fn，返回出一个新的函数，因此mapState就指向这个新函数，它接收两个参数：namespace和map。
做了什么事情？首先判断传入的namespace，如果不是字符串，就把传入的第一个参数作为map，namespace赋值为''。满足是字符串，但最后一个字符不是 / ，要给namespace末尾加上 / 
最后返回 fn(namespace, map)，也就是说mapState执行其实返回了fn的执行结果
我们具体看看传入的fn是怎么样的：
```js
function (namespace, states) {
  var res = {};
  normalizeMap(states).forEach(function (ref) {
    // ...
  });
  return res
}
```
可以看到这个fn执行返回res对象，normalizeMap(states)遍历的过程中肯定往res对象添加属性了，中间具体做了什么，我们看看normalizeMap(states)，返回了什么内容，下面是normalizeMap的实现
```js
function normalizeMap (map) {
  return Array.isArray(map)
    ? map.map(key => ({ key, val: key }))
    : Object.keys(map).map(key => ({ key, val: map[key] }))
}
```
normalizeMap接收states，也就是mapState接收的第二个参数（对象形式）
normalizeMap中，首先判断map是否为数组，如果是，将数组每项key 转成 {key:key, val:key}这种结构
如果不是，Object.keys获取map对象的所有自有属性组成的数组，然后将每一项key转成 {key, val:map[key]}
normalizeMap其实就是做的一种map对象的形式上的整理

```js
normalizeMap(states).forEach(function (ref) {
  var key = ref.key;
  var val = ref.val;

  res[key] = function mappedState () {
    var state = this.$store.state;
    var getters = this.$store.getters;
    if (namespace) {
      var module = getModuleByNamespace(this.$store, 'mapState', namespace);
      if (!module) {
        return
      }
      state = module.context.state;
      getters = module.context.getters;
    }
    return typeof val === 'function'
      ? val.call(this, state, getters)
      : state[val]
  };
  // mark vuex getter for devtools
  res[key].vuex = true;
});
```
现在对normalizeMap(states)进行遍历，key拿到元素项的key，val拿到元素项的val，res是一个空对象，现在要在res对象中添加方法，属性值为key，方法为mappedState函数。
mappedState函数中，state指向store对象的state对象，getters指向store对象的getters对象。接下来判断namespace是否存在，也就是有没有给mapState传字符串，命名空间字符串。如果有，调用getModuleByNamespace获取到它对应的模块对象，赋给module，我们粗略看看getModuleByNamespace的实现：

```js
var module = getModuleByNamespace(this.$store, 'mapState', namespace);
// 
function getModuleByNamespace (store, helper, namespace) {
    var module = store._modulesNamespaceMap[namespace];
    if (!module) {
      console.error(("[vuex] module namespace not found in " + helper + "(): " + namespace));
    }
    return module
  }
```
你可以看到，getModuleByNamespace接收三个参数：store对象，'mapState'这个辅助函数的函数名，namespace命名空间字符串
首先会去store._modulesNamespaceMap这个存放命名空间对应的模块的对象，去找出namespace对应的module，然后返回模块
如果module不存在，报错提示：你要找的namespace这个命名空间在_modulesNamespaceMap中找不到对应的模块

我们在实例化Store的时候，已经把所有的模块都以 namespace 为key的形式添加到了store._modulesNamespaceMap对象中。

```js
if (namespace) {
  var module = getModuleByNamespace(this.$store, 'mapState', namespace);
  if (!module) {
    return
  }
  state = module.context.state;
  getters = module.context.getters;
}
```
判断module不存在就直接返回，state赋值为module.context.state，这个又是什么，其实这是带命名空间模块的state，getters拿到带命名空间模块的getters

```js
return typeof val === 'function'
        ? val.call(this, state, getters)
        : state[val]
```
val是什么，它是normalizeMap(states)中当前遍历的项的val值，如果它是函数（说明你传的map是一个对象，属性值是函数形式的），直接调用，执行时this指向当前Vue实例，传入state，getters。如果不是函数（说明你传的map是字符串组成的数组形式），返回state[val]，即state对象中对应的state。。。

综上，mapState函数的第一个参数可以接收，模块的空间命名字符串，可以不传，然后是一个map对象，mapState执行返回一个对象res，里面存放了一个个键值对，key是你在map中命名的属性，属性值一个函数，函数执行返回state对象中对应state值

因为mapState执行返回一个对象，你可以这么使用mapState

比如
```js
 computed: mapState({
    count: state => state.count,
    countAlias: 'count',
    // 传字符串参数 'count' 等同于 `state => state.count`    
    countPlusLocalState (state) {
      return state.count + this.localCount
    }
    // 为了能够使用 `this` 获取局部状态，必须使用常规函数
  })
```
我们知道mapState传入的这个的对象，就是map对象，它会经过normalizeMap的处理，转成数组，每个元素是一个对象{key,val}，然后遍历这个数组，往待返回的对象res里添加方法，方法名为key，如果val是一个函数就直接返回val的执行结果，如果不是，就返回state中val的值，比如上面的 state.count
mapState执行返回出的对象，作为computed选项，那么count，countAlias，countPlusLocalState都成为了计算属性

给mapState传入的map对象还可以是数组，比如这么写：
```js
computed: mapState([
  'count',// 映射 this.count 为 store.state.count
  'xxxxx'
])
```
mapState会将数组的每项转成 {'count':'count'} 这样的形式，遍历数组，往res对象里添加方法，方法名为'count'，方法本身执行返回 store.state.count

因为mapState返回的是一个对象，并且每个键值对拿出来就是一个computed，我们可以用对象展开运算符 将它混入到计算属性中，这样就不影响你写别的computed
```js
computed: {
  localComputed () { /* ... */ },
  ...mapState({
    // ...
  })
}
```
那带命名空间的模块里的state呢，怎么通过mapState获取，可以这么写
```js
computed: {
  ...mapState({
    a: state => state.some.nested.module.a,
    b: state => state.some.nested.module.b
  })
},
```
使用mapState绑定带命名空间的模块时，这么写比较繁琐
你可以将模块的空间名称字符串作为第一个参数传入mapState，这样所有的绑定会自动将该模块作为上下文
```js
computed: {
  ...mapState('some/nested/module', {
    a: state => state.a,
    b: state => state.b
  })
},
```
由前面的源码我们知道，mapState会根据namespace获取对应的模块，然后函数中的state就不再取根state，取module.context.state，也就是这个模块对应的state（当地化的意思），剩余的逻辑和前面一样，将第二个参数map对象，mapState返回出对象，key为你写的a，对应的函数，函数执行返回state => state.a的执行结果，只是现在的state并不是根state对象，而是当地化的state

他妈的，终于搞懂了mapState内部实现

### mapGetters
和mapState的实现很像
```js
  var mapGetters = normalizeNamespace((namespace, getters) => {
  const res = {}
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
我们这直接讲了，不分段了。mapGetters接收namespace（可选）和getters（一个map对象），mapGetters执行也就是normalizeNamespace传入的函数执行，准备一个待返回的对象res，将传入的map对象经过normalizeMap处理成数组，map对象有两种形式：

1. ['getter1', 'getter2']   数组项就是store里getter的真实名字
2. { myGetter1: 'getter1'}  你想将getter属性取另一个名字，就这样使用对象形式

key取数组项里的key，val取它的val，如果存在命名空间的话，val = namespace + val;
往res对象中添加键值对，属性值为key，属性值为函数，函数返回store里的getters中val对应的getter，最后mapGetters执行返回出这个res对象

所以...mapGetter()出来的一个个计算属性，他们的函数返回值是store.getters对应的属性值


### mapActions
```js
  var mapActions = normalizeNamespace((namespace, actions) => {
    const res = {}
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
和前面俩一样，mapActions执行也就是normalizeNamespace的参数回调执行，回调函数中，准备一个空对象res，
normalizeMap会将mapActions接收的action对象格式化成一个数组，遍历数组，往res对象中添加键值对，key: 一个函数
这个函数所接收的参数组成了数组args，这个函数中，先缓存了this.$store.dispatch的方法，如果namespace存在，说明mapActions时传入的第一个参数是带命名空间的字符串，根据namespace获取对应的模块，获取不到就直接返回，然后把dispatch变量更新为所找到的模块对应的dispatch方法（local的，当地化后的）
最后判断val是否是一个函数，是则直接调用，this指向当前Vue实例，如果是一个函数，（这里没太搞懂，但可以肯定的是我们经常不这么写）如果不是一个函数，则调用dispatch方法，this指向store对象，传入action的名字字符串，即val，和作为method接收的参数args。

比如，你会这么写：
```js
methods:{
  ...mapActions(['action1', 'action2']),

  ...mapActions({
    myAction3: 'action3'
  }),
}
```
第一个mapActions执行返回的对象中，{ 'action1': 函数1, 'action2': 函数2 }
这个对象被展开后混入methods中成为method，那么函数1作为method，它接收的参数，参数数组args
函数1里面做的事情就是 this.$store.dispatch('action1', ...args)
就像下面这样
```js
action1(...args){
  this.$store.dispatch('action1', ...args)
}
```
第二个mapActions执行返回的对象，会像这样：{ 'myAction3' : 函数3 }
这个对象被展开后混入methods，成为method，它接收的参数放到一个数组里args
```js
myAction3(...args){
  this.$store.dispatch('action3', ...args)
}
```
所以函数3里做的事情就是 this.$store.dispatch('action3', ...args)


### mapMutations

```js
var mapMutations = normalizeNamespace((namespace, mutations) => {
    const res = {}
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
同样的，mapMutations执行相当于(namespace, mutations) => {....这个回调执行，返回出一个对象res
比如你这么使用：
```js
methods: {
    ...mapMutations(['muta1',  'muta2' ]),

    ...mapMutations({ myMuta3: 'muta3' })
  }
```
比如第一个，返回的res对象就像这样: { 'muta1': 函数1 ,  'muta2': 函数2  }
muta1就成了method名，method值为函数1，那函数1接收的参数数组为args
函数1其实就是源码中的mappedMutation函数，它做了什么：获取this.$store.commit，如果传来模块命名空间字符串，就获取模块本地化的commit，然后 执行 commit.apply(this.$store, [val].concat(args))
也就是 `this.$store.commit('muta1', ...args)`

第二个也类似，变成这样的method
```js
methods:{
  myMuta3(...args){
    this.$store.commit('muta3' , ...args)
  }
}
```

现在好像 Vuex源码基本分析完了。。
